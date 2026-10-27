// Reconciliation only touches this store's payments: store marker + reference prefix,
// other apps (AZPOR-…) and stores on the same key, the other mode, the cutoff date,
// payments of earlier plugin versions, cleanup of old items. Test key; sync every minute.
import {
  api, cartDone, check, evtId, fakeCredentials, login, logDir, mockLog, mockPayment, mockSeed, mockSet,
  newCart, runSuite, setupStore, sleep, sql, sqlScript, startStack, waitFor, webhook,
} from "../lib/harness.mjs"

const { apiKey: API_KEY, secret: SECRET } = fakeCredentials()
const hook = (event) => webhook(event, SECRET)
const one = async (q, params) => (await sql(q, params))[0]
const eventStatus = (id) => one("select status, last_error from doit_event where event_id = $1", [id])
const inLedger = async (doitId) => !!(await one("select 1 from doit_payment where doit_id = $1 and deleted_at is null", [doitId]))
const openItems = async () => (await sql("select dedupe_key from doit_attention where status = 'open'")).map((r) => r.dedupe_key)
const daysAgo = (n) => new Date(Date.now() - n * 86_400_000).toISOString()

await runSuite(async () => {
  const { up } = await startStack(logDir("05-reconcile-scope"), { env: { DOIT_SYNC_CRON: "* * * * *" } })
  check("server :9300 + worker :9301 up", up)
  if (!up) return
  await login()
  const { region, variantId } = await setupStore()

  // credentials saved in the Admin → credentials_saved_at = now (the default cutoff)
  const saved = await api("POST", "/admin/doit/settings", { api_key: API_KEY, webhook_secret: SECRET, reference_prefix: "HK-", timezone: "Asia/Jakarta" })
  const rec = saved.json.settings?.reconciliation
  const storeId = (await api("GET", "/admin/stores")).json.stores[0].id
  check("settings: store marker = Medusa store id, prefix HK-, default cutoff = credentials saved", saved.status === 200 && rec.store_id === storeId && rec.reference_prefix === "HK-" && rec.ignore_before_source === "credentials_saved" && !!rec.ignore_before, JSON.stringify(rec))
  check("invalid prefix → 400", (await api("POST", "/admin/doit/settings", { reference_prefix: "bad prefix!" })).status === 400)

  // --- payments this store creates carry the marker and the prefix
  const a = await newCart(region.id, variantId)
  const create = (await mockLog()).filter((l) => l.method === "POST" && l.path === "/v1/payments").pop()
  check("new payment: reference HK-<session>, metadata.medusa_store_id", create?.body?.reference === `HK-${a.session.id}` && create.body.metadata?.medusa_store_id === storeId, JSON.stringify({ ref: create?.body?.reference, meta: create?.body?.metadata }))
  await mockSet(a.session.data.id, { status: "paid", paid_at: new Date().toISOString() })
  const own = { id: evtId("own"), type: "payment.paid", data: await mockPayment(a.session.data.id, API_KEY) }
  check("own payment.paid → 200", (await hook(own)).status === 200)
  check("own payment with prefixed reference → order", !!(await waitFor(() => cartDone(a.cart.id), 60_000)))

  // --- payments that are not this store's
  const foreign = {
    azpor: await mockSeed({ reference: "AZPOR-20261027-0001", amount: 99000, metadata: null }),
    otherStore: await mockSeed({ reference: "payses_STAGING01", metadata: { medusa_store_id: "store_STAGING", medusa_payment_session_id: "payses_STAGING01" } }),
    live: await mockSeed({ reference: `HK-${a.session.id}`, environment: "live", metadata: { medusa_store_id: storeId } }),
    old: await mockSeed({ reference: "HK-payses_OLD", created_at: daysAgo(2), metadata: { medusa_store_id: storeId } }),
    legacyGone: await mockSeed({ reference: "payses_GONE01", metadata: { medusa_payment_session_id: "payses_GONE01" } }),
  }
  const expectReason = { azpor: "unmarked", otherStore: "other_store", live: "environment", old: "before_cutoff", legacyGone: "legacy_unknown" }
  for (const [name, p] of Object.entries(foreign)) {
    const e = { id: evtId(name), type: "payment.paid", data: p }
    check(`${name}: payment.paid webhook → 200`, (await hook(e)).status === 200)
    const st = await waitFor(async () => { const r = await eventStatus(e.id); return r?.status && r.status !== "received" ? r : null }, 20_000)
    check(`${name}: event ignored (${expectReason[name]}), not in the ledger`, st?.status === "ignored" && st.last_error?.includes(expectReason[name]) && !(await inLedger(p.id)), JSON.stringify(st))
  }
  const refundEvt = { id: evtId("rf"), type: "refund.failed", data: { id: "rf_az", payment_id: foreign.azpor.id, amount: 1000, status: "failed" } }
  await hook(refundEvt)
  check("refund.failed for another app's payment → ignored, no refund_failed item", (await waitFor(async () => (await eventStatus(refundEvt.id))?.status === "ignored", 20_000)) && !(await openItems()).some((k) => k.startsWith("refund_failed")))
  check("nothing raised under Perlu tindakan by those payments", !(await openItems()).some((k) => Object.values(foreign).some((p) => k.includes(p.id))), (await openItems()).join(","))

  // --- an item an earlier version raised for another app's payment gets dismissed by the sync job
  await sqlScript(`
    insert into doit_payment (id, doit_id, reference, status, amount, fee_amount, net_amount, total_amount, fee_payer, rail, environment, raw, session_id, doit_created_at)
    values ('doitpay_oldaz', 'pay_oldaz', 'AZPOR-OLD', 'paid', 50000, 0, 50000, 50000, 'merchant', 'qris', 'test',
            '{"id":"pay_oldaz","reference":"AZPOR-OLD","environment":"test","status":"paid"}', null, now() - interval '1 day'),
           ('doitpay_oldses', 'pay_oldses', 'payses_FROMOTHERDB', 'paid', 50000, 0, 50000, 50000, 'merchant', 'qris', 'test',
            '{"id":"pay_oldses","reference":"payses_FROMOTHERDB","environment":"test","status":"paid"}', 'payses_FROMOTHERDB', now() - interval '1 day');
    insert into doit_attention (id, code, dedupe_key, status, doit_payment_id, message)
    values ('doitatt_oldaz', 'paid_without_session', 'paid_without_session:pay_oldaz', 'open', 'pay_oldaz', 'old item'),
           ('doitatt_oldses', 'paid_without_session', 'paid_without_session:pay_oldses', 'open', 'pay_oldses', 'old item');
  `)
  const runStart = new Date()
  console.log("INFO  waiting for the sync job (every minute)…")
  const state = await waitFor(async () => {
    const s = await one("select last_success_at, stats from doit_sync_state where key = 'payments:doit'")
    return s?.last_success_at && new Date(s.last_success_at) > runStart ? s : null
  }, 150_000, 3000)
  check("sync ran: foreign payments counted as ignored, not scanned into the ledger", state?.stats?.ignored >= 5 && !(await inLedger(foreign.azpor.id)) && !(await inLedger(foreign.live.id)), JSON.stringify(state?.stats))
  const dismissed = await sql("select dedupe_key, status, resolution_note from doit_attention where id in ('doitatt_oldaz','doitatt_oldses') order by id")
  check("old items for payments that are not this store's → dismissed with a note", dismissed.length === 2 && dismissed.every((d) => d.status === "dismissed" && d.resolution_note.includes("bukan pembayaran toko ini")), JSON.stringify(dismissed))
  check("old unsettled foreign row is not settled again (marked handled)", !!(await one("select reconciled_at from doit_payment where doit_id = 'pay_oldses'"))?.reconciled_at)
  check("own order still reconciled", !!(await one("select order_id from doit_payment where doit_id = $1", [a.session.data.id]))?.order_id)

  // --- the cutoff date chosen in the Admin
  const tomorrow = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Jakarta" }).format(new Date(Date.now() + 86_400_000))
  const set = (await api("POST", "/admin/doit/settings", { ignore_before: tomorrow })).json.settings.reconciliation
  await sleep(3000) // the worker drops its cached settings on doit.settings.updated
  check("ignore_before saved as 00:00 Asia/Jakarta of that date", set.ignore_before_source === "setting" && set.ignore_before === new Date(`${tomorrow}T00:00:00+07:00`).toISOString(), JSON.stringify(set))
  const b = await newCart(region.id, variantId)
  await mockSet(b.session.data.id, { status: "paid", paid_at: new Date().toISOString() })
  const early = { id: evtId("cut"), type: "payment.paid", data: await mockPayment(b.session.data.id, API_KEY) }
  await hook(early)
  check("own payment created before the chosen date → ignored, no order", (await waitFor(async () => (await eventStatus(early.id))?.status === "ignored", 20_000)) && !(await cartDone(b.cart.id)))
  const cleared = (await api("POST", "/admin/doit/settings", { ignore_before: null })).json.settings.reconciliation
  check("clearing the date → back to the default (credentials saved)", cleared.ignore_before_source === "credentials_saved")
  // redelivered (new event ids) until the worker has the cleared setting
  check("same payment after clearing → order", !!(await waitFor(async () => {
    if (await cartDone(b.cart.id)) return true
    await hook({ ...early, id: evtId("cut2") })
    return false
  }, 60_000, 5000)))
  check("bad date → 400", (await api("POST", "/admin/doit/settings", { ignore_before: "2026-13-40" })).status === 400)
})
