// Storefront endpoints: GET /store/doit/carts/:id/payment and GET /store/doit/methods.
// Access rules, throttled status refresh, cart completion after paid, rate limits.
// Server :9300 + worker :9301, mock :9399. No webhooks are sent: polling alone must be enough.
import {
  api, BASE, cartDone, check, fakeCredentials, login, logDir, mockLog, mockSet,
  newCart, runSuite, setupStore, sql, startStack, waitFor,
} from "../lib/harness.mjs"

const { apiKey: API_KEY, secret: SECRET } = fakeCredentials()
const status = (cartId, opts = {}) => api("GET", `/store/doit/carts/${cartId}/payment`, null, { store: true, ...opts })

async function customer(email) {
  const reg = await fetch(`${BASE}/auth/customer/emailpass/register`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email, password: "rahasia-123" }) })
  const regToken = (await reg.json()).token
  await api("POST", "/store/customers", { email, first_name: "Budi" }, { store: true, headers: { authorization: `Bearer ${regToken}` } })
  const res = await fetch(`${BASE}/auth/customer/emailpass`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email, password: "rahasia-123" }) })
  return { authorization: `Bearer ${(await res.json()).token}` }
}

await runSuite(async () => {
  const { up } = await startStack(logDir("04-store"), { env: { DOIT_API_KEY: API_KEY, DOIT_WEBHOOK_SECRET: SECRET } })
  check("server :9300 + worker :9301 up", up)
  if (!up) return
  await login()
  const { region, variantId } = await setupStore()

  // --- status of a QRIS session
  const q = await newCart(region.id, variantId)
  const s1 = await status(q.cart.id)
  check("GET payment status → 200, next_action wait, poll 5 s", s1.status === 200 && s1.json.next_action === "wait" && s1.json.poll_after_ms === 5000, `${s1.status} ${s1.text.slice(0, 200)}`)
  check("payment: QRIS content, hosted_url, expires_at, amounts", s1.json.payment?.rail === "qris" && !!s1.json.payment.qr_content && /^https:\/\//.test(s1.json.payment.hosted_url) && !!s1.json.payment.expires_at && s1.json.payment.amount === 150000, JSON.stringify(s1.json.payment))
  check("no idempotency key, metadata, customer or flags in the response", !/"(idempotency_key|metadata|customer|flags|session_id|requested_rail)"/.test(s1.text), s1.text.slice(0, 300))
  check("Cache-Control: no-store", s1.headers.get("cache-control") === "no-store")

  // --- access
  const noKey = await status(q.cart.id, { pk: null })
  check("without publishable key → rejected, nothing leaked", noKey.status >= 400 && !noKey.text.includes("qr_content"), String(noKey.status))
  const pos = (await api("POST", "/admin/sales-channels", { name: "POS" })).json.sales_channel
  const otherKey = (await api("POST", "/admin/api-keys", { title: "pos", type: "publishable" })).json.api_key
  await api("POST", `/admin/api-keys/${otherKey.id}/sales-channels`, { add: [pos.id] })
  check("publishable key of another sales channel → 404", (await status(q.cart.id, { pk: otherKey.token })).status === 404)
  check("unknown cart id → 404", (await status("cart_01JZZZZZZZZZZZZZZZZZZZZZZZ")).status === 404)
  check("malformed cart id → 404", (await status("cart_x';--")).status === 404)
  const noSession = (await api("POST", "/store/carts", { region_id: region.id, items: [{ variant_id: variantId, quantity: 1 }] }, { store: true })).json.cart
  const ns = await status(noSession.id)
  check("cart without a doit session → 404", ns.status === 404, ns.text.slice(0, 120))

  const budi = await customer("budi.store@e2e.test")
  const ani = await customer("ani.store@e2e.test")
  const owned = await newCart(region.id, variantId, { headers: budi, email: "budi.store@e2e.test" })
  check("customer cart created with a session", !!owned.session?.data?.id && !!owned.cart.customer_id)
  check("registered customer's cart without login → 404", (await status(owned.cart.id)).status === 404)
  check("registered customer's cart, other customer → 404", (await status(owned.cart.id, { headers: ani })).status === 404)
  check("registered customer's cart, owner → 200", (await status(owned.cart.id, { headers: budi })).status === 200)

  // --- throttled refresh: polling does not hammer doit.id
  const payId = q.session.data.id
  const reads = async () => (await mockLog()).filter((l) => l.method === "GET" && l.path === `/v1/payments/${payId}`).length
  const before = await reads()
  for (let i = 0; i < 8; i++) await status(q.cart.id)
  check("8 polls within the refresh window → no extra doit.id read", (await reads()) === before, `${before} → ${await reads()}`)

  // --- paid at doit.id (no webhook) → complete_cart, then the order
  await mockSet(payId, { status: "paid", paid_at: new Date().toISOString() })
  const paid = await waitFor(async () => { const r = await status(q.cart.id); return r.json.next_action === "complete_cart" ? r : null }, 20_000, 2000)
  check("paid at doit.id → next_action complete_cart within the refresh window", !!paid, paid ? paid.json.payment.status : "")
  check("status reads stay bounded (≤ 1 per 10 s)", (await reads()) - before <= 3, String((await reads()) - before))
  const done = await api("POST", `/store/carts/${q.cart.id}/complete`, {}, { store: true })
  check("cart complete after paid → order", done.json?.type === "order", `${done.status} ${done.text.slice(0, 160)}`)
  const s2 = await status(q.cart.id)
  check("after the order: next_action view_order + order_id, poll stops", s2.json.next_action === "view_order" && s2.json.order_id === done.json?.order?.id && s2.json.poll_after_ms === null, JSON.stringify({ a: s2.json.next_action, o: s2.json.order_id }))

  // --- VA picked by the storefront
  const v = await newCart(region.id, variantId, { data: { rail: "va", va_bank: "bmri" } })
  const sv = await status(v.cart.id)
  check("VA session: va_number + bank, customer-paid fee in total", sv.json.payment?.rail === "va" && sv.json.payment.va_bank === "bmri" && !!sv.json.payment.va_number && sv.json.payment.total_amount === 154000, JSON.stringify(sv.json.payment))

  // --- expired / failed → retry
  const x = await newCart(region.id, variantId)
  await mockSet(x.session.data.id, { status: "expired" })
  const sx = await status(x.cart.id)
  check("expired at doit.id → next_action retry, no polling", sx.json.next_action === "retry" && sx.json.poll_after_ms === null && sx.json.payment.status === "expired", JSON.stringify({ a: sx.json.next_action, s: sx.json.payment?.status }))
  check("expired cart stays open", !(await cartDone(x.cart.id)))

  // --- methods
  const m = await api("GET", `/store/doit/methods?cart_id=${v.cart.id}`, null, { store: true })
  const codes = (m.json.methods ?? []).map((x) => x.code)
  check("methods for the cart: QRIS + VA banks, fee for the cart total, cc hidden", m.status === 200 && m.json.source === "doit" && m.json.amount === 150000 && codes.includes("qris") && codes.includes("va_bmri") && !codes.includes("cc"), `${m.status} ${codes.join(",")} amount=${m.json.amount}`)
  const bmri = m.json.methods?.find((x) => x.code === "va_bmri")
  check("method fee: va_bmri 4000 paid by customer, total 154000", bmri?.fee_amount === 4000 && bmri.fee_payer === "customer" && bmri.total_amount === 154000, JSON.stringify(bmri))
  check("methods: default rail from settings", m.json.default?.rail === "qris")
  const methodCalls = (await mockLog()).filter((l) => l.path === "/v1/methods").length
  await api("GET", `/store/doit/methods?cart_id=${v.cart.id}`, null, { store: true })
  check("methods cached (no second /v1/methods call)", (await mockLog()).filter((l) => l.path === "/v1/methods").length === methodCalls)
  check("methods for someone else's cart → 404", (await api("GET", `/store/doit/methods?cart_id=${owned.cart.id}`, null, { store: true })).status === 404)
  check("methods without cart → list without amounts", (await api("GET", "/store/doit/methods", null, { store: true })).json.amount === null)
  check("methods with a non-doit provider → 400", (await api("GET", "/store/doit/methods?provider_id=pp_system_default", null, { store: true })).status === 400)

  // --- switching method and back reuses the still-open invoice
  const sw = await newCart(region.id, variantId, { data: { rail: "qris" } })
  const firstQris = sw.session.data.id
  const session = (data) => api("POST", `/store/payment-collections/${sw.pc.id}/payment-sessions`, { provider_id: "pp_doit_doit", data }, { store: true }).then((r) => r.json.payment_collection?.payment_sessions?.[0])
  const toVa = await session({ rail: "va", va_bank: "bmri" })
  check("switch to VA → new invoice", /^pay_/.test(toVa?.data?.id) && toVa.data.id !== firstQris && toVa.data.rail === "va")
  const backQris = await session({ rail: "qris" })
  check("back to QRIS while its invoice is open → same invoice reused", backQris?.data?.id === firstQris && backQris.data.reused_invoice === true && backQris.id !== sw.session.id, `${backQris?.data?.id} vs ${firstQris}`)
  const backVa = await session({ rail: "va", va_bank: "bmri" })
  check("back to VA Mandiri → its invoice reused", backVa?.data?.id === toVa.data.id)
  const otherBank = await session({ rail: "va", va_bank: "bnia" })
  check("another bank → new invoice", otherBank?.data?.id && ![firstQris, toVa.data.id].includes(otherBank.data.id))
  const created = (await mockLog()).filter((l) => l.method === "POST" && l.path === "/v1/payments" && l.body?.metadata?.medusa_payment_collection_id === sw.pc.id)
  check("doit.id invoices for this cart: 3 created for 5 sessions, all tagged with the collection", created.length === 3, String(created.length))
  const reuseFinal = await session({ rail: "qris" })
  check("final pick QRIS → first invoice again", reuseFinal?.data?.id === firstQris)

  // pay the reused invoice: its reference is the first (deleted) session
  await mockSet(firstQris, { status: "paid", paid_at: new Date().toISOString() })
  const swPaid = await waitFor(async () => { const r = await status(sw.cart.id); return r.json.next_action === "complete_cart" ? r : null }, 20_000, 2000)
  check("reused invoice paid → complete_cart", !!swPaid)
  const swDone = await api("POST", `/store/carts/${sw.cart.id}/complete`, {}, { store: true })
  check("cart with the reused invoice completes → order", swDone.json?.type === "order", swDone.text.slice(0, 160))
  const swOrderId = swDone.json?.order?.id
  const note = await waitFor(async () => (await api("GET", `/admin/orders/${swOrderId}?fields=metadata`)).json.order?.metadata?.doit, 20_000)
  check("order.metadata.doit: invoice, rail, fee and who paid it", note?.payment_id === firstQris && note.rail === "qris" && note.fee_payer === "merchant" && note.fee_amount === 1050 && note.merchant_fee === 1050 && note.customer_fee === 0 && note.total_amount === 150000, JSON.stringify(note))
  const ledger = await waitFor(async () => (await sql("select order_id, session_id, fee_amount, fee_payer, net_amount, reconciled_at from doit_payment where doit_id = $1 and order_id is not null", [firstQris]))[0], 20_000)
  check("ledger row right after the order (no webhook): order, current session, fee, net", ledger?.order_id === swOrderId && ledger.session_id === reuseFinal.id && ledger.fee_amount === 1050 && ledger.net_amount === 148950 && !!ledger.reconciled_at, JSON.stringify(ledger))

  // VA order: the shopper paid the fee on top
  const vaPaid = sv.json.payment
  await mockSet(vaPaid.id, { status: "paid", paid_at: new Date().toISOString() })
  await waitFor(async () => (await status(v.cart.id)).json.next_action === "complete_cart", 20_000, 2000)
  const vaOrder = await api("POST", `/store/carts/${v.cart.id}/complete`, {}, { store: true })
  const vaNote = await waitFor(async () => (await api("GET", `/admin/orders/${vaOrder.json?.order?.id}?fields=metadata`)).json.order?.metadata?.doit, 20_000)
  check("VA order note: customer paid 4000 on top, total 154000, captured amount 150000", vaNote?.customer_fee === 4000 && vaNote.total_amount === 154000 && vaNote.amount === 150000, JSON.stringify(vaNote))

  // --- the QR image expires before the invoice
  const qx = await newCart(region.id, variantId)
  await mockSet(qx.session.data.id, { rail: null, qr_content: null })
  const sq = await status(qx.cart.id)
  check("QR released (rail/qr null, still pending) → qr_expired, rail kept, hosted_url", sq.json.qr_expired === true && sq.json.next_action === "wait" && sq.json.payment.rail === "qris" && !!sq.json.payment.hosted_url, JSON.stringify({ e: sq.json.qr_expired, r: sq.json.payment?.rail }))
  check("QR live → qr_expired false", s1.json.qr_expired === false)

  // --- methods outside the amount limits are listed, disabled
  // (mock QRIS max is 10 000 000; a 12 000 000 cart)
  const big = (await api("POST", "/store/carts", { region_id: region.id, items: [{ variant_id: variantId, quantity: 80 }] }, { store: true })).json.cart
  const bm = await api("GET", `/store/doit/methods?cart_id=${big.id}`, null, { store: true })
  const bq = bm.json.methods?.find((m) => m.code === "qris")
  check("methods: QRIS over its limit stays listed with within_limits false", bq?.within_limits === false && bm.json.methods.some((m) => m.code === "va_bmri" && m.within_limits === true), JSON.stringify(bq))

  // --- rate limit: 40 / minute per cart (start from a fresh per-IP minute window)
  await new Promise((r) => setTimeout(r, 61_000))
  const r = await newCart(region.id, variantId)
  const codesSeen = []
  let retryAfter = null
  for (let i = 0; i < 45; i++) {
    const res = await status(r.cart.id)
    codesSeen.push(res.status)
    if (res.status === 429) retryAfter = res.headers.get("retry-after")
  }
  const ok = codesSeen.filter((c) => c === 200).length
  check("per-cart rate limit: 40 × 200 then 429 with Retry-After", ok === 40 && codesSeen.slice(40).every((c) => c === 429) && Number(retryAfter) > 0, `${ok} ok, retry-after ${retryAfter}`)
  check("other carts are not affected by one cart's limit", (await status(v.cart.id)).status === 200)
})
