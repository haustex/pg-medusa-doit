// Provider + webhook edge: session creation, signature middleware, capture via
// webhook, bayar_ganda, refunds, bayar_telat. Server :9300 + worker :9301, mock :9399.
import {
  api, cartDone, check, evtId, fakeCredentials, login, logDir, mockLog, mockPayment, mockSet,
  newCart, runSuite, setupStore, sign, sleep, startStack, waitFor, webhook,
} from "../lib/harness.mjs"

const { apiKey: API_KEY, secret: SECRET } = fakeCredentials()
const hook = (event, opts, providerPath) => webhook(event, SECRET, opts, providerPath)

await runSuite(async () => {
  const { up, worker } = await startStack(logDir("01-provider-webhook"), { env: { DOIT_API_KEY: API_KEY, DOIT_WEBHOOK_SECRET: SECRET } })
  check("server :9300 (server mode) + worker :9301 up", up)
  if (!up) return

  check("admin login", !!(await login()))
  const providers = (await api("GET", "/admin/payments/payment-providers")).json.payment_providers?.map((p) => p.id)
  check("provider pp_doit_doit registered", providers?.includes("pp_doit_doit"), JSON.stringify(providers))
  const { region, regions, variantId } = await setupStore({ extraRegions: [{ name: "US", currency_code: "usd", countries: ["us"] }] })
  check("region IDR + product Rp150.000", !!region?.id && !!variantId)

  // --- initiate
  const { cart, ses, session } = await newCart(region.id, variantId, { data: { return_url: "https://toko.test/order/confirmed" } })
  check("payment session created (200)", ses.status === 200, `status ${ses.status}`)
  check("session data: id pay_…, hosted_url, qr_content, expires_at",
    /^pay_/.test(session?.data?.id) && !!session?.data?.hosted_url && !!session?.data?.qr_content && !!session?.data?.expires_at,
    JSON.stringify({ id: session?.data?.id, rail: session?.data?.rail }))
  let log = await mockLog()
  const create = log.find((l) => l.method === "POST" && l.path === "/v1/payments")
  check("POST /v1/payments: amount 150000 (no ×100), reference = session id", create?.body?.amount === 150000 && create?.body?.reference === session?.id, JSON.stringify(create?.body))
  check("POST /v1/payments carries Idempotency-Key session id + hash", new RegExp(`^${session?.id}-[0-9a-f]{16}$`).test(create?.idem ?? ""), create?.idem)
  check("return_url forwarded", create?.body?.return_url === "https://toko.test/order/confirmed")

  const usdCart = await newCart(regions.usd.id, variantId)
  check("non-IDR session rejected", usdCart.ses.status >= 400, `status ${usdCart.ses.status} ${JSON.stringify(usdCart.ses.json).slice(0, 120)}`)

  const badBank = await newCart(region.id, variantId, { data: { rail: "va", va_bank: "bca" } })
  check("rail va with a transfer-only bank rejected before calling doit.id", badBank.ses.status === 400, JSON.stringify(badBank.ses.json).slice(0, 120))

  // --- complete while pending: must not create an order
  const early = await api("POST", `/store/carts/${cart.id}/complete`, {}, { store: true })
  check("cart complete while pending → no order", early.json?.type !== "order", `type ${early.json?.type} status ${early.status}`)

  // --- middleware
  const payId = session.data.id
  await mockSet(payId, { status: "paid", paid_at: new Date().toISOString() })
  const evt = { id: evtId(), type: "payment.paid", created_at: new Date().toISOString(), data: await mockPayment(payId, API_KEY) }
  check("bad signature → 401", (await hook(evt, { secret: "whsec_wrong" })).status === 401)
  check("missing signature → 401", (await hook(evt, { header: null })).status === 401)
  check("timestamp 6 min old → 401", (await hook(evt, { t: Math.floor(Date.now() / 1000) - 360 })).status === 401)
  check("timestamp 6 min ahead → 401", (await hook(evt, { t: Math.floor(Date.now() / 1000) + 360 })).status === 401)
  const pretty = JSON.stringify(evt, null, 2)
  check("signature over different bytes (re-serialised) → 401", (await hook(evt, { raw: pretty, header: sign(JSON.stringify(evt), SECRET) })).status === 401)
  check("other provider path not touched by middleware (no 401)", (await hook(evt, { header: null }, "system_default")).status !== 401)
  await sleep(1500)
  check("no order after rejected webhooks", !(await cartDone(cart.id)))

  const ok = await hook(evt, { raw: pretty, header: sign(pretty, SECRET) })
  check("valid signature over exact raw bytes (pretty JSON) → 200", ok.status === 200, ok.body)
  const dup = await hook(evt)
  check("redelivered event id → 200 duplicate, not queued", dup.status === 200 && dup.body.includes("duplicate"), dup.body)

  const order = await waitFor(async () => {
    if (!(await cartDone(cart.id))) return null
    const o = (await api("GET", "/admin/orders?fields=id,payment_status,*payment_collections.payments.captures")).json.orders
    return o?.find((x) => x.payment_status === "captured") ?? null
  }, 60_000)
  check("payment.paid webhook → cart completed, order payment_status captured", !!order, order ? order.id : worker.log().slice(-1500))
  const payment = order?.payment_collections?.[0]?.payments?.[0]
  check("exactly one capture of 150000", payment?.captures?.length === 1 && Number(payment.captures[0].amount) === 150000, JSON.stringify(payment?.captures?.map((c) => c.amount)))
  check("signature re-verified in worker (Redis Buffer)", worker.log().includes(`Webhook ${evt.id} payment.paid`) && !worker.log().includes("rejected in worker"))

  // --- completing the cart again (storefront after the webhook) returns the same order
  const again = await api("POST", `/store/carts/${cart.id}/complete`, {}, { store: true })
  check("cart complete after webhook → same order, no second capture", again.json?.type === "order" && again.json.order?.id === order?.id, `type ${again.json?.type}`)

  // --- bayar_ganda: second payment.paid with a new event id
  const evt2 = { ...evt, id: evtId("g"), data: { ...evt.data, flags: ["bayar_ganda"] } }
  check("bayar_ganda webhook → 200", (await hook(evt2)).status === 200)
  check("bayar_ganda logged PERLU TINDAKAN overpaid", !!(await waitFor(async () => worker.log().includes("PERLU TINDAKAN overpaid"), 20_000)))
  const after = (await api("GET", `/admin/orders/${order?.id}?fields=*payment_collections.payments.captures`)).json.order
  check("bayar_ganda: still exactly one capture", after?.payment_collections?.[0]?.payments?.[0]?.captures?.length === 1)

  check("webhook.test → 200", (await hook({ id: evtId("t"), type: "webhook.test", data: {} })).status === 200)

  // --- refund
  const rf = await api("POST", `/admin/payments/${payment?.id}/refund`, { amount: 50000 })
  log = await mockLog()
  const refundReq = log.find((l) => l.method === "POST" && l.path === `/v1/payments/${payId}/refunds`)
  check("admin refund 50000 → POST /refunds", rf.status === 200 && refundReq?.body?.amount === 50000, `status ${rf.status} ${JSON.stringify(rf.json).slice(0, 160)}`)
  check("refund Idempotency-Key = Medusa refund id", /^ref_/.test(refundReq?.idem ?? ""), refundReq?.idem)
  const tooMuch = await api("POST", `/admin/payments/${payment?.id}/refund`, { amount: 100001 })
  check("refund above the remaining amount refused by the plugin", tooMuch.status >= 400, `status ${tooMuch.status}`)

  // --- reused invoice paid by webhook: its reference is an earlier, deleted session
  const ru = await newCart(region.id, variantId)
  const firstId = ru.session.data.id
  const firstSession = ru.session.id
  const again2 = async (data) => (await api("POST", `/store/payment-collections/${ru.pc.id}/payment-sessions`, { provider_id: "pp_doit_doit", data }, { store: true })).json.payment_collection?.payment_sessions?.[0]
  await again2({ rail: "va", va_bank: "bmri" })
  const reusedSession = await again2({ rail: "qris" })
  check("QRIS → VA → QRIS reuses the first invoice in a new session", reusedSession?.data?.id === firstId && reusedSession.id !== firstSession)
  await mockSet(firstId, { status: "paid", paid_at: new Date().toISOString() })
  const reusedPaid = await mockPayment(firstId, API_KEY)
  check("doit.id still references the first session", reusedPaid.reference === firstSession)
  check("payment.paid for the reused invoice → 200", (await hook({ id: evtId("r"), type: "payment.paid", data: reusedPaid })).status === 200)
  check("webhook finds the current session through the collection → order", !!(await waitFor(() => cartDone(ru.cart.id), 60_000)), worker.log().split("\n").filter((l) => l.includes(firstId)).slice(-2).join(" | "))

  // --- bayar_telat (accept): expired → paid late
  const c2 = await newCart(region.id, variantId)
  await mockSet(c2.session.data.id, { status: "expired" })
  const exp = { id: evtId("e"), type: "payment.expired", data: await mockPayment(c2.session.data.id, API_KEY) }
  check("payment.expired → 200", (await hook(exp)).status === 200)
  await sleep(2000)
  check("expired: no order", !(await cartDone(c2.cart.id)))
  await mockSet(c2.session.data.id, { status: "paid", paid_at: new Date().toISOString(), flags: ["bayar_telat"] })
  const late = { id: evtId("l"), type: "payment.paid", data: await mockPayment(c2.session.data.id, API_KEY) }
  check("bayar_telat payment.paid → 200", (await hook(late)).status === 200)
  check("bayar_telat with open session (policy accept) → order created", !!(await waitFor(() => cartDone(c2.cart.id), 60_000)))

})
