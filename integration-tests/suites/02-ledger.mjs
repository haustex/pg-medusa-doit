// Ledger, DB dedupe, "perlu tindakan" items, refund totals, sync job.
// Server :9300 + worker :9301, mock :9399, sync cron every minute.
import {
  api, cartDone, check, evtId, fakeCredentials, login, logDir, mockPayment, mockSeed, mockSet,
  newCart, runSuite, setupStore, sql, startStack, waitFor, webhook,
} from "../lib/harness.mjs"

const { apiKey: API_KEY, secret: SECRET } = fakeCredentials()
const hook = (event) => webhook(event, SECRET)
const one = async (q, params) => (await sql(q, params))[0]
const attentionRows = (code) => sql("select code, status, dedupe_key, doit_payment_id, order_id, amount, message from doit_attention where code = $1 order by created_at", [code])
const paymentRow = (id) => one("select * from doit_payment where doit_id = $1", [id])

await runSuite(async () => {
  const { up, worker } = await startStack(logDir("02-ledger"), { env: { DOIT_API_KEY: API_KEY, DOIT_WEBHOOK_SECRET: SECRET, DOIT_SYNC_CRON: "* * * * *" } })
  check("server :9300 + worker :9301 up", up)
  if (!up) return
  const tables = (await sql("select table_name from information_schema.tables where table_name like 'doit_%' order by 1")).map((r) => r.table_name)
  check("ledger tables migrated", ["doit_attention", "doit_event", "doit_payment", "doit_refund", "doit_sync_state", "doit_withdrawal"].every((t) => tables.includes(t)), tables.join(","))

  await login()
  const { region, variantId } = await setupStore()

  // A. normal payment.paid
  const a = await newCart(region.id, variantId)
  const payA = a.session.data.id
  await mockSet(payA, { status: "paid", paid_at: new Date().toISOString() })
  const evA = { id: evtId("a"), type: "payment.paid", created_at: new Date().toISOString(), data: await mockPayment(payA, API_KEY) }
  check("A webhook → 200", (await hook(evA)).status === 200)
  check("A order created", await waitFor(() => cartDone(a.cart.id), 60_000))
  const evRowA = await waitFor(() => one("select status, attempts from doit_event where event_id = $1 and status = 'processed'", [evA.id]), 20_000)
  check("A doit_event processed, attempts 1", evRowA?.attempts === 1, JSON.stringify(evRowA))
  const rowA = await waitFor(() => one("select status, session_id, order_id, reconciled_at from doit_payment where doit_id = $1 and order_id is not null", [payA]), 20_000)
  check("A doit_payment paid, session + order linked, reconciled", rowA?.status === "paid" && rowA.session_id === a.session.id && /^order_/.test(rowA.order_id) && !!rowA.reconciled_at, JSON.stringify(rowA))

  // B. dedupe in DB
  const dup = await hook(evA)
  check("B redelivery of processed event → 200 duplicate", dup.status === 200 && dup.body.includes("duplicate"), dup.body)
  const evB = { id: evtId("b"), type: "payment.expired", data: { ...(await mockPayment(payA, API_KEY)), status: "expired" } }
  const rs = await Promise.all([hook(evB), hook(evB), hook(evB)])
  check("B 3 concurrent deliveries: all 200, exactly 2 marked duplicate", rs.every((r) => r.status === 200) && rs.filter((r) => r.body.includes("duplicate")).length === 2, rs.map((r) => r.body).join(" | "))
  check("B one doit_event row for the id", (await one("select count(*)::int n from doit_event where event_id = $1", [evB.id])).n === 1)
  await waitFor(() => one("select 1 from doit_event where event_id = $1 and status = 'processed'", [evB.id]), 20_000)
  check("B stale payment.expired after paid does not regress the ledger", (await paymentRow(payA))?.status === "paid")

  // C. bayar_ganda
  const evC = { id: evtId("c"), type: "payment.paid", data: { ...(await mockPayment(payA, API_KEY)), flags: ["bayar_ganda"] } }
  check("C bayar_ganda webhook → 200", (await hook(evC)).status === 200)
  const over = await waitFor(async () => (await attentionRows("overpaid"))[0], 20_000)
  check("C perlu tindakan overpaid (open, linked to order)", over?.status === "open" && over.doit_payment_id === payA && /^order_/.test(over.order_id ?? ""), JSON.stringify(over))
  await hook({ ...evC, id: evtId("c2") })
  await waitFor(async () => (await one("select count(*)::int n from doit_event where type = 'payment.paid' and status = 'processed'")).n >= 3, 20_000)
  check("C second bayar_ganda event → still one overpaid item", (await attentionRows("overpaid")).length === 1)
  const captures = (await one("select count(*)::int n from capture c join payment p on p.id = c.payment_id where p.payment_session_id = $1", [a.session.id])).n
  check("C still exactly one capture in Medusa", captures === 1, String(captures))

  // D. refunds
  const orders = (await api("GET", "/admin/orders?fields=id,*payment_collections.payments")).json.orders
  const medusaPayment = orders.flatMap((o) => o.payment_collections.flatMap((pc) => pc.payments)).find((p) => p.payment_session_id === a.session.id)
  const rf = await api("POST", `/admin/payments/${medusaPayment?.id}/refund`, { amount: 50000 })
  check("D admin refund 50000 → 200", rf.status === 200, rf.status !== 200 ? JSON.stringify(rf.json).slice(0, 200) : "")
  const refundRow = await waitFor(() => one("select doit_refund_id, medusa_refund_id, amount, status, source from doit_refund where doit_payment_id = $1", [payA]), 20_000)
  check("D doit_refund from the POST /refunds response (rf id + Medusa refund id)", /^rf_/.test(refundRow?.doit_refund_id ?? "") && /^ref_/.test(refundRow?.medusa_refund_id ?? "") && refundRow.status === "succeeded" && refundRow.source === "api", JSON.stringify(refundRow))
  check("D doit_payment.refunded_amount = 50000 while doit status stays paid", (await waitFor(() => one("select refunded_amount, status from doit_payment where doit_id = $1 and refunded_amount = 50000", [payA]), 10_000))?.status === "paid")
  check("D no refund_mismatch when totals agree", (await attentionRows("refund_mismatch")).length === 0)
  const evD = { id: evtId("d"), type: "refund.succeeded", data: { id: refundRow?.doit_refund_id, payment_id: payA, amount: 50000, status: "succeeded", reason: null } }
  check("D refund.succeeded webhook for the same refund → 200", (await hook(evD)).status === 200)
  await waitFor(() => one("select 1 from doit_event where event_id = $1 and status = 'processed'", [evD.id]), 20_000)
  const afterD = await one("select count(*)::int n, sum(amount)::int s, max(webhook_event_id) w from doit_refund where doit_payment_id = $1", [payA])
  check("D same refund not double counted (1 row, webhook id attached)", afterD.n === 1 && afterD.s === 50000 && afterD.w === evD.id, JSON.stringify(afterD))
  await hook({ id: evtId("d2"), type: "refund.succeeded", data: { id: "rf_portal1", payment_id: payA, amount: 20000, status: "succeeded" } })
  const mismatch = await waitFor(async () => (await attentionRows("refund_mismatch"))[0], 20_000)
  check("D refund made outside Medusa → refunded 70000 + refund_mismatch (20000)", mismatch?.amount === 20000 && (await paymentRow(payA)).refunded_amount === 70000, JSON.stringify(mismatch))
  await hook({ id: evtId("d3"), type: "refund.failed", data: { id: "rf_fail1", payment_id: payA, amount: 10000, status: "failed", reason: "rekening tujuan ditutup" } })
  const failedItem = await waitFor(async () => (await attentionRows("refund_failed"))[0], 20_000)
  check("D refund.failed → refund_failed item with reason, total unchanged", failedItem?.message?.includes("rekening tujuan ditutup") && (await paymentRow(payA)).refunded_amount === 70000, JSON.stringify(failedItem))

  // E. webhook that gives up after 3 attempts (signed paid event, doit.id still says pending)
  const e = await newCart(region.id, variantId)
  const evE = { id: evtId("e"), type: "payment.paid", data: { ...(await mockPayment(e.session.data.id, API_KEY)), status: "paid" } }
  check("E webhook → 200", (await hook(evE)).status === 200)
  const gaveUp = await waitFor(() => one("select status, attempts, last_error from doit_event where event_id = $1 and status = 'failed'", [evE.id]), 60_000)
  check("E doit_event failed after 3 attempts", gaveUp?.attempts === 3, JSON.stringify(gaveUp))
  const wf = (await attentionRows("webhook_failed")).find((r) => r.dedupe_key === `webhook_failed:${evE.id}`)
  check("E perlu tindakan webhook_failed", wf?.status === "open", JSON.stringify(wf))
  check("E no order for the pending payment", !(await cartDone(e.cart.id)))

  // F. sync job: paid at doit.id, webhook lost → order completed by the job
  const f = await newCart(region.id, variantId)
  const payF = f.session.data.id
  await mockSet(payF, { status: "paid", paid_at: new Date().toISOString() })
  await mockSeed()
  console.log("INFO  waiting for the sync job (runs every minute)…")
  check("F sync job completed the order without a webhook", !!(await waitFor(() => cartDone(f.cart.id), 150_000, 3000)))
  const rowF = await paymentRow(payF)
  check("F ledger row paid + reconciled + order linked", rowF?.status === "paid" && !!rowF.reconciled_at && /^order_/.test(rowF.order_id ?? ""), JSON.stringify({ s: rowF?.status, o: rowF?.order_id }))
  check("F payment made outside Medusa is in the ledger (no session)", (await one("select session_id from doit_payment where reference = 'INV/PORTAL'"))?.session_id === null)
  const state = await one("select key, cursor, last_success_at, last_error, stats from doit_sync_state")
  check("F sync state saved (cursor, success, no error)", !!state?.cursor && !!state.last_success_at && !state.last_error, JSON.stringify(state))
  check("F sync log line", worker.log().includes("[doit] Sync doit:"))
  const rowE = await paymentRow(e.session.data.id)
  check("F sync corrected the ledger of the falsely-paid payment from E back to pending", rowE?.status === "pending" && !rowE.reconciled_at, JSON.stringify({ s: rowE?.status }))
  check("F sync stats: no settle errors", !(state?.stats?.reconcile_errors > 0), JSON.stringify(state?.stats))
})
