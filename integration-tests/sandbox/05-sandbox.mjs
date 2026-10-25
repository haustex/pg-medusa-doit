// Against the real doit.id sandbox (pb_test_ key from DOIT_TEST_API_KEY). Skips without it.
// doit.id cannot reach localhost, so webhooks are signed locally with a throwaway secret.
// WAIT_PAID_MS > 0 waits that long for someone to click "Simulasikan lunas" in the portal
// on the QRIS payment, then checks capture and refunds; the default skips that part.
import crypto from "node:crypto"
import {
  api, cartDone, check, info, login, logDir, newCart, runSuite, setupStore, sleep, startStack, waitFor, webhook,
} from "../lib/harness.mjs"

const KEY = process.env.DOIT_TEST_API_KEY
if (!KEY?.startsWith("pb_test_")) {
  console.log("SKIP: DOIT_TEST_API_KEY (pb_test_…) is not set")
  process.exit(0)
}
const WAIT_PAID_MS = Number(process.env.WAIT_PAID_MS || 0)
const SECRET = `whsec_${crypto.randomBytes(18).toString("base64url")}`

async function doit(method, p, body, idem) {
  const res = await fetch(`https://pay.doit.id${p}`, {
    method,
    headers: { authorization: `Bearer ${KEY}`, "content-type": "application/json", ...(idem ? { "idempotency-key": idem } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  })
  return { status: res.status, json: await res.json().catch(() => null) }
}

await runSuite(async () => {
  const { up } = await startStack(logDir("05-sandbox"), { mock: false, env: { DOIT_API_KEY: KEY, DOIT_WEBHOOK_SECRET: SECRET } })
  check("Medusa :9300 + worker :9301 up with the sandbox key", up)
  if (!up) return
  await login()
  const { region, variantId } = await setupStore()

  // QRIS
  const q = await newCart(region.id, variantId, { data: { return_url: "https://toko.test/order/confirmed" } })
  const qd = q.session?.data ?? {}
  check("QRIS session on sandbox", q.ses.status === 200 && /^pay_/.test(qd.id) && !!qd.qr_content && !!qd.hosted_url, `status ${q.ses.status} ${q.ses.status !== 200 ? q.ses.text : ""}`)
  info(`QRIS ${qd.id} fee=${qd.fee_amount} payer=${qd.fee_payer} total=${qd.total_amount} env=${qd.environment} hosted_url=${qd.hosted_url}`)
  const remote = await doit("GET", `/v1/payments/${qd.id}`)
  check("GET /v1/payments/{id}: reference = session id, amount 150000", remote.json?.reference === q.session?.id && remote.json?.amount === 150000, `${remote.json?.reference} ${remote.json?.amount}`)
  const replay = await doit("POST", "/v1/payments", { amount: 1, reference: "x", rail: "qris" }, qd.idempotency_key)
  check("Idempotency-Key replay → 200 with the original payment", replay.status === 200 && replay.json?.id === qd.id, `status ${replay.status}`)

  // VA picked by the storefront
  const v = await newCart(region.id, variantId, { data: { rail: "va", va_bank: "bmri" } })
  const vd = v.session?.data ?? {}
  check("VA bmri session on sandbox", v.ses.status === 200 && !!vd.va_number && vd.rail === "va", `status ${v.ses.status}`)

  // store endpoints against the real API
  const st = await api("GET", `/store/doit/carts/${v.cart.id}/payment`, null, { store: true })
  check("store status endpoint (sandbox): pending VA, wait", st.status === 200 && st.json.next_action === "wait" && st.json.payment.va_number === vd.va_number && !!st.json.checked_at, st.text.slice(0, 200))
  const methods = await api("GET", `/store/doit/methods?cart_id=${q.cart.id}`, null, { store: true })
  const codes = (methods.json.methods ?? []).map((m) => m.code)
  check("store methods (sandbox): qris + VA banks with fees, no cc", methods.json.source === "doit" && codes.includes("qris") && codes.some((c) => c.startsWith("va_")) && !codes.includes("cc") && methods.json.methods.every((m) => typeof m.fee_amount === "number"), codes.join(","))

  // switching method and back reuses the open invoice (needs metadata in GET /v1/payments)
  const sw = async (data) => (await api("POST", `/store/payment-collections/${q.pc.id}/payment-sessions`, { provider_id: "pp_doit_doit", data }, { store: true })).json.payment_collection?.payment_sessions?.[0]
  const qVa = await sw({ rail: "va", va_bank: "bnia" })
  const qBack = await sw({ rail: "qris" })
  check("sandbox: QRIS → VA → QRIS reuses the first invoice", qBack?.data?.id === qd.id && qBack.data.reused_invoice === true && qVa?.data?.id !== qd.id, `${qBack?.data?.id} vs ${qd.id}`)
  info(`list metadata: ${JSON.stringify((await doit("GET", "/v1/payments?status=pending&limit=5")).json?.data?.find((p) => p.id === qd.id)?.metadata)}`)

  // pending: complete must fail; a signed-but-false paid webhook must not create an order
  const early = await api("POST", `/store/carts/${v.cart.id}/complete`, {}, { store: true })
  check("complete cart while sandbox payment pending → no order", early.json?.type !== "order", `type ${early.json?.type}`)
  const forged = { id: `evt_f${Date.now()}`, type: "payment.paid", data: { ...(await doit("GET", `/v1/payments/${vd.id}`)).json, status: "paid" } }
  check("signed payment.paid with fabricated status → 200 at the edge", (await webhook(forged, SECRET)).status === 200)
  await sleep(6000)
  check("…but no order: the status is re-read from doit.id (still pending)", !(await cartDone(v.cart.id)))
  const rfPending = await doit("POST", `/v1/payments/${vd.id}/refunds`, { amount: 1000 }, `rf-pending-${Date.now()}`)
  check("refund on pending → 409 payment_not_refundable", rfPending.status === 409 && rfPending.json?.error?.code === "payment_not_refundable", `${rfPending.status}`)

  if (!WAIT_PAID_MS) {
    info("WAIT_PAID_MS not set: skipping the paid / refund part (needs a click on \"Simulasikan lunas\").")
    return
  }
  console.log(`\nWAITING_FOR_PAID ${qd.id}: click "Simulasikan lunas" in the doit.id portal (up to ${Math.round(WAIT_PAID_MS / 60000)} min)`)
  const paid = await waitFor(async () => { const r = await doit("GET", `/v1/payments/${qd.id}`); return r.json?.status === "paid" ? r.json : null }, WAIT_PAID_MS, 10_000)
  check("sandbox payment marked paid", !!paid)
  if (!paid) return
  const ps = await waitFor(async () => { const r = await api("GET", `/store/doit/carts/${q.cart.id}/payment`, null, { store: true }); return r.json.next_action === "complete_cart" ? r : null }, 30_000, 3000)
  check("store status endpoint sees paid → complete_cart", !!ps)
  const done = await api("POST", `/store/carts/${q.cart.id}/complete`, {}, { store: true })
  check("cart complete → order", done.json?.type === "order", done.text.slice(0, 160))
  const order = (await api("GET", `/admin/orders/${done.json?.order?.id}?fields=payment_status,*payment_collections.payments.captures`)).json.order
  const payment = order?.payment_collections?.[0]?.payments?.[0]
  check("order captured once for 150000", order?.payment_status === "captured" && payment?.captures?.length === 1 && Number(payment.captures[0].amount) === 150000, order?.payment_status)
  const r1 = await api("POST", `/admin/payments/${payment?.id}/refund`, { amount: 50000 })
  check("Admin partial refund 50000 → sandbox", r1.status === 200, `${r1.status}`)
  const r2 = await api("POST", `/admin/payments/${payment?.id}/refund`, { amount: 100000 })
  check("Admin refund of the remaining 100000 → sandbox", r2.status === 200, `${r2.status}`)
  info(`status after full refund: ${(await doit("GET", `/v1/payments/${qd.id}`)).json?.status} (sandbox keeps "paid")`)
})
