// A live key (pb_live_…): a test-mode payment with this store's marker is ignored,
// while the store's own live payments are reconciled as usual.
import crypto from "node:crypto"
import {
  api, cartDone, check, evtId, login, logDir, mockPayment, mockSeed, mockSet, newCart, randomHex, runSuite,
  setupStore, sql, startStack, waitFor, webhook,
} from "../lib/harness.mjs"

const API_KEY = `pb_live_FAKE${randomHex(12)}`
const SECRET = `whsec_${crypto.randomBytes(18).toString("base64url")}`
const hook = (event) => webhook(event, SECRET)
const one = async (q, params) => (await sql(q, params))[0]

await runSuite(async () => {
  const { up } = await startStack(logDir("06-live-key"), { env: { DOIT_API_KEY: API_KEY, DOIT_WEBHOOK_SECRET: SECRET } })
  check("server :9300 + worker :9301 up with a live key", up)
  if (!up) return
  await login()
  const { region, variantId } = await setupStore()
  const storeId = (await api("GET", "/admin/stores")).json.stores[0].id

  const own = await newCart(region.id, variantId)
  check("live key → live payment", own.session?.data?.environment === "live", own.session?.data?.environment)

  const testPayment = await mockSeed({ reference: `payses_TESTMODE01`, environment: "test", metadata: { medusa_store_id: storeId, medusa_payment_session_id: "payses_TESTMODE01" } })
  const e1 = { id: evtId("tm"), type: "payment.paid", data: testPayment }
  check("test payment.paid while the live key is active → 200", (await hook(e1)).status === 200)
  const st = await waitFor(async () => { const r = await one("select status, last_error from doit_event where event_id = $1", [e1.id]); return r?.status !== "received" ? r : null }, 20_000)
  check("…ignored (environment), not in the ledger, no item", st?.status === "ignored" && st.last_error.includes("environment") && !(await one("select 1 from doit_payment where doit_id = $1", [testPayment.id])) && !(await one("select 1 from doit_attention where doit_payment_id = $1", [testPayment.id])), JSON.stringify(st))

  await mockSet(own.session.data.id, { status: "paid", paid_at: new Date().toISOString() })
  const e2 = { id: evtId("lv"), type: "payment.paid", data: await mockPayment(own.session.data.id, API_KEY) }
  check("own live payment.paid → 200", (await hook(e2)).status === 200)
  check("own live payment → order", !!(await waitFor(() => cartDone(own.cart.id), 60_000)))
  check("ledger row environment live", (await waitFor(async () => (await one("select environment from doit_payment where doit_id = $1", [own.session.data.id]))?.environment, 20_000)) === "live")
})
