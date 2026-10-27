// Admin API: settings, test connection, stats, payments, export, withdrawals,
// CSV import, perlu tindakan. Seeds the ledger with SQL; the JS rows are the ground truth.
// Server :9300 + worker :9301, mock :9399.
import { api as baseApi, BASE, check, ctx, fakeCredentials, login, logDir, runSuite, sql, sqlScript, startStack } from "../lib/harness.mjs"

const { apiKey: API_KEY, secret: SECRET } = fakeCredentials()
const one = async (q, params) => (await sql(q, params))[0]
const count = async (q) => Number((await one(q)).n)
const api = (method, p, body, { auth = true } = {}) => baseApi(method, p, body, { auth })

// ---------------------------------------------------------------- seed (JS is the ground truth)
const tzOffset = "+07"
const rows = []
let seq = 0
function pay(p) { rows.push({ id: `doitpay_seed${++seq}`, doit_id: `pay_seed${seq}`, reference: `payses_seed${seq}`, rail: "qris", va_bank: null, flags: null, refunded: 0, ...p }); return rows[rows.length - 1] }
for (let i = 1; i <= 40; i++) {
  const day = String(1 + (i % 25)).padStart(2, "0")
  const merchant = i % 2 === 1
  const amount = 100000 + i * 1000
  const fee = merchant ? 1000 : 4000
  pay({ status: "paid", env: "test", amount, fee, net: merchant ? amount - fee : amount, fee_payer: merchant ? "merchant" : "customer",
    rail: i % 3 === 0 ? "va" : "qris", va_bank: i % 3 === 0 ? "bmri" : null, created: `2026-10-${day} 02:00${tzOffset}`, paid: `2026-10-${day} 03:00${tzOffset}`, flags: i === 7 ? ["bayar_telat"] : null })
}
// 00:30 Jakarta on 26 Oct = 25 Oct 17:30 UTC: belongs to 26 Oct in Asia/Jakarta, 25 Oct in UTC
const boundary = pay({ status: "paid", env: "test", amount: 77777, fee: 0, net: 77777, fee_payer: "merchant", created: "2026-10-25T17:00:00Z", paid: "2026-10-25T17:30:00Z", reference: "INV/BOUNDARY" })
for (let i = 1; i <= 5; i++) pay({ status: "pending", env: "test", amount: 50000, fee: 0, net: 50000, fee_payer: "merchant", created: `2026-10-${String(10 + i).padStart(2, "0")} 10:00${tzOffset}`, paid: null })
for (let i = 1; i <= 6; i++) pay({ status: "expired", env: "test", amount: 60000, fee: 0, net: 60000, fee_payer: "merchant", created: `2026-10-0${i} 10:00${tzOffset}`, paid: null })
for (let i = 1; i <= 2; i++) pay({ status: "failed", env: "test", amount: 70000, fee: 0, net: 70000, fee_payer: "merchant", created: `2026-10-2${i} 10:00${tzOffset}`, paid: null })
for (let i = 1; i <= 3; i++) pay({ status: "paid", env: "live", amount: 999000, fee: 9000, net: 990000, fee_payer: "merchant", created: `2026-10-1${i} 10:00${tzOffset}`, paid: `2026-10-1${i} 10:05${tzOffset}` })
for (let i = 1; i <= 2; i++) pay({ status: "paid", env: "test", amount: 200000, fee: 2000, net: 198000, fee_payer: "merchant", created: `2026-09-1${i} 10:00${tzOffset}`, paid: `2026-09-1${i} 10:05${tzOffset}` })
const refundTargets = [rows[0], rows[1], rows[2]]
const refunds = [
  { id: "doitref_s1", rf: "rf_seed1", pay: refundTargets[0].doit_id, amount: 30000, status: "succeeded", at: `2026-10-20 12:00${tzOffset}` },
  { id: "doitref_s2", rf: "rf_seed2", pay: refundTargets[1].doit_id, amount: 20000, status: "succeeded", at: `2026-10-21 12:00${tzOffset}` },
  { id: "doitref_s3", rf: "rf_seed3", pay: refundTargets[2].doit_id, amount: 10000, status: "failed", at: `2026-10-22 12:00${tzOffset}` },
]
refundTargets[0].refunded = 30000; refundTargets[1].refunded = 20000

const q = (v) => (v === null || v === undefined ? "null" : typeof v === "number" ? String(v) : `'${String(v).replace(/'/g, "''")}'`)
function seedSql() {
  const values = rows.map((r) => `(${[r.id, r.doit_id, r.reference, r.status, r.amount, r.fee, r.net, r.amount + (r.fee_payer === "customer" ? r.fee : 0), r.fee_payer, r.rail, r.va_bank, r.env, r.flags ? JSON.stringify(r.flags) : null, r.refunded, r.paid, r.created].map(q).join(",")})`)
  return `
    insert into doit_payment (id, doit_id, reference, status, amount, fee_amount, net_amount, total_amount, fee_payer, rail, va_bank, environment, flags, refunded_amount, paid_at, doit_created_at)
    values ${values.join(",\n")};
    insert into doit_refund (id, doit_refund_id, doit_payment_id, amount, status, source, created_at)
    values ${refunds.map((r) => `(${[r.id, r.rf, r.pay, r.amount, r.status, "webhook", r.at].map(q).join(",")})`).join(",")};
    -- volume: 5000 paid test payments in August, to show aggregates stay in SQL
    insert into doit_payment (id, doit_id, reference, status, amount, fee_amount, net_amount, total_amount, fee_payer, rail, environment, paid_at, doit_created_at)
    select 'doitpay_bulk' || g, 'pay_bulk' || g, 'BULK/' || g, 'paid', 10000, 0, 10000, 10000, 'merchant', 'qris', 'test',
           timestamptz '2026-08-01 00:00+07' + (g % 31) * interval '1 day', timestamptz '2026-08-01 00:00+07' + (g % 31) * interval '1 day'
    from generate_series(1, 5000) g;
    insert into doit_attention (id, code, dedupe_key, status, doit_payment_id, message, amount)
    values ('doitatt_s1', 'overpaid', 'overpaid:pay_seed5', 'open', 'pay_seed5', 'pay_seed5 dibayar dua kali (bayar_ganda). Refund kelebihan bayar secara manual.', null),
           ('doitatt_s2', 'refund_mismatch', 'refund_mismatch:pay_seed6:70000:50000', 'open', 'pay_seed6', 'pay_seed6: refund tidak cocok (Total refund doit.id 70000, Medusa 50000, nominal 106000).', 20000);
  `
}

const inOct = (ts, tz = "Asia/Jakarta") => {
  if (!ts) return false
  const d = new Intl.DateTimeFormat("en-CA", { timeZone: tz }).format(new Date(ts.replace(" ", "T").replace(/\+07$/, "+07:00")))
  return d >= "2026-10-01" && d <= "2026-10-31"
}
function expected(tz = "Asia/Jakarta", from = "2026-10-01", to = "2026-10-31") {
  const day = (ts) => new Intl.DateTimeFormat("en-CA", { timeZone: tz }).format(new Date(ts.replace(" ", "T").replace(/\+07$/, "+07:00")))
  const inR = (ts) => ts && day(ts) >= from && day(ts) <= to
  const test = rows.filter((r) => r.env === "test")
  const paid = test.filter((r) => r.status === "paid" && inR(r.paid))
  const sum = (a, k) => a.reduce((s, r) => s + r[k], 0)
  const allPaidTest = test.filter((r) => r.status === "paid")
  const refundOk = refunds.filter((r) => r.status === "succeeded")
  return {
    success: { count: paid.length, amount: sum(paid, "amount") },
    pending: { count: test.filter((r) => r.status === "pending" && inR(r.created)).length },
    failed: { count: test.filter((r) => ["expired", "failed"].includes(r.status) && inR(r.created)).length },
    refunds: { count: refundOk.length, amount: sum(refundOk, "amount") },
    fee: sum(paid, "fee"),
    net: sum(paid, "net"),
    balanceNet: sum(allPaidTest, "net") + 5000 * 10000,
    refunded: sum(refundOk, "amount"),
  }
}

await runSuite(async () => {
  await sqlScript(seedSql())
  check("seeded ledger (SQL)", (await count("select count(*) n from doit_payment")) === rows.length + 5000)

  // The seeded items have no Medusa session, so a sync run would (rightly) dismiss them:
  // keep the job from firing during this suite.
  const { up } = await startStack(logDir("03-admin"), { env: { DOIT_API_KEY: API_KEY, DOIT_WEBHOOK_SECRET: SECRET, DOIT_SYNC_CRON: "0 0 1 1 *" } })
  check("server :9300 + worker :9301 up", up)
  if (!up) return

  // auth
  for (const p of ["/admin/doit/stats", "/admin/doit/payments", "/admin/doit/attention", "/admin/doit/withdrawals", "/admin/doit/settings"]) {
    const r = await api("GET", p, null, { auth: false })
    check(`unauthenticated GET ${p} → 401`, r.status === 401, String(r.status))
  }
  const r401 = await api("POST", "/admin/doit/withdrawals", { date: "2026-10-01", amount: 1 }, { auth: false })
  check("unauthenticated POST withdrawal → 401", r401.status === 401)
  check("admin login", !!(await login()))

  // settings
  let s = (await api("GET", "/admin/doit/settings")).json.settings
  check("settings: timezone default Asia/Jakarta, webhook_url, encryption status", s.timezone === "Asia/Jakarta" && s.webhook_url === `${BASE}/hooks/payment/doit_doit` && !!s.encryption.status, JSON.stringify({ tz: s.timezone, url: s.webhook_url, enc: s.encryption.status }))
  const save = await api("POST", "/admin/doit/settings", { api_key: API_KEY, webhook_secret: SECRET, rail: "va", va_bank: "bmri", expires_in: 3600, timezone: "Asia/Jakarta" })
  s = save.json.settings
  check("settings saved via Admin (rail va/bmri, source admin, secrets masked)", save.status === 200 && s.rail === "va" && s.va_bank === "bmri" && s.credential_source === "admin" && s.api_key.masked?.endsWith(API_KEY.slice(-4)), JSON.stringify({ rail: s.rail, src: s.credential_source, masked: s.api_key.masked }))
  check("secrets never returned in plain text", !save.text.includes(API_KEY) && !save.text.includes(SECRET))
  const badTz = await api("POST", "/admin/doit/settings", { timezone: "Mars/Olympus" })
  check("invalid timezone → 400", badTz.status === 400, JSON.stringify(badTz.json).slice(0, 120))

  // test connection
  const tc = (await api("POST", "/admin/doit/test-connection", {})).json
  check("test connection with stored key: ok, methods listed", tc.ok === true && tc.methods.some((m) => m.code === "qris"), JSON.stringify(tc).slice(0, 200))
  check("test connection hides the undocumented cc rail", tc.ok && !tc.methods.some((m) => m.rail === "cc"))
  const tcBad = (await api("POST", "/admin/doit/test-connection", { api_key: "pb_test_REVOKED_key_123456" })).json
  check("test connection with a rejected key → ok:false + doit.id error code", tcBad.ok === false && tcBad.error.code === "invalid_api_key", JSON.stringify(tcBad))
  check("test connection rejects a malformed key → 400", (await api("POST", "/admin/doit/test-connection", { api_key: "sk_123" })).status === 400)

  // stats
  const exp = expected()
  const t0 = Date.now()
  const st = await api("GET", "/admin/doit/stats?preset=custom&from=2026-10-01&to=2026-10-31")
  const ms = Date.now() - t0
  const S = st.json.stats
  check("stats 200, mode test", st.status === 200 && st.json.mode === "test", String(st.status))
  check(`stats: Sukses ${exp.success.count} / ${exp.success.amount}`, S.success.count === exp.success.count && S.success.amount === exp.success.amount, JSON.stringify(S.success))
  check(`stats: Menunggu ${exp.pending.count}, Gagal/Kedaluwarsa ${exp.failed.count}`, S.pending.count === exp.pending.count && S.failed.count === exp.failed.count, JSON.stringify({ p: S.pending, f: S.failed }))
  check(`stats: Refund ${exp.refunds.count} / ${exp.refunds.amount} (failed refund excluded)`, S.refunds.count === exp.refunds.count && S.refunds.amount === exp.refunds.amount, JSON.stringify(S.refunds))
  check(`stats: Gross/Fee/Net ${exp.success.amount}/${exp.fee}/${exp.net}`, S.gross === exp.success.amount && S.fee === exp.fee && S.net === exp.net, JSON.stringify({ g: S.gross, f: S.fee, n: S.net }))
  const liveOct = rows.filter((r) => r.env === "live" && r.status === "paid" && inOct(r.paid)).reduce((a, r) => a + r.amount, 0)
  check("stats: live payments excluded in test mode", liveOct > 0 && S.success.amount === exp.success.amount && S.success.amount !== exp.success.amount + liveOct)
  check(`stats: saldo estimasi = net all time − refund − withdraw (${exp.balanceNet} − ${exp.refunded} − 0)`, S.balance.estimate === exp.balanceNet - exp.refunded && S.balance.withdrawn === 0, JSON.stringify(S.balance))
  check("stats: open perlu tindakan = 2", S.open_attention === 2)
  check("series: 31 days, zero-filled, sums match", st.json.series.length === 31 && st.json.series.reduce((a, p) => a + p.gross, 0) === exp.success.amount, String(st.json.series.length))
  check(`stats with 5 000+ rows answered in ${ms} ms, response ${st.text.length} bytes (aggregated in SQL)`, ms < 1500 && st.text.length < 10_000)
  const day26 = st.json.series.find((p) => p.date === "2026-10-26")
  check("Asia/Jakarta: 25 Oct 17:30 UTC counts on 26 Oct", day26?.gross >= 77777 && st.json.series.find((p) => p.date === "2026-10-25").gross === rows.filter((r) => r !== boundary && r.env === "test" && r.status === "paid" && r.paid?.startsWith("2026-10-25")).reduce((a, r) => a + r.amount, 0), JSON.stringify(day26))
  const today = await api("GET", "/admin/doit/stats?preset=today")
  check("preset today resolves to Jakarta's date", today.json.range.from === new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Jakarta" }).format(new Date()), JSON.stringify(today.json.range))
  check("bad range → 400", (await api("GET", "/admin/doit/stats?preset=custom&from=2026-10-31&to=2026-10-01")).status === 400)
  await api("POST", "/admin/doit/settings", { timezone: "UTC" })
  const utc = (await api("GET", "/admin/doit/stats?preset=custom&from=2026-10-25&to=2026-10-25")).json
  check("timezone changed to UTC in settings: the boundary payment moves to 25 Oct", utc.range.timezone === "UTC" && utc.series[0].gross >= 77777, JSON.stringify(utc.series))
  await api("POST", "/admin/doit/settings", { timezone: "Asia/Jakarta" })

  // payments table
  const p1 = (await api("GET", "/admin/doit/payments?preset=custom&from=2026-10-01&to=2026-10-31&limit=20&offset=0")).json
  const testOct = rows.filter((r) => r.env === "test" && inOct(r.created))
  check(`payments: count ${testOct.length}, page of 20`, p1.count === testOct.length && p1.payments.length === 20, `${p1.count}/${p1.payments.length}`)
  const p3 = (await api("GET", `/admin/doit/payments?preset=custom&from=2026-10-01&to=2026-10-31&limit=20&offset=40`)).json
  check("payments: last page", p3.payments.length === testOct.length - 40, String(p3.payments.length))
  const pf = (await api("GET", "/admin/doit/payments?preset=custom&from=2026-10-01&to=2026-10-31&status=failed&limit=100")).json
  check("payments: status=failed includes expired", pf.count === 8 && pf.payments.every((p) => ["failed", "expired"].includes(p.status)), String(pf.count))
  const pv = (await api("GET", "/admin/doit/payments?preset=custom&from=2026-10-01&to=2026-10-31&rail=va&limit=100")).json
  check("payments: rail=va", pv.count === rows.filter((r) => r.env === "test" && inOct(r.created) && r.rail === "va").length && pv.payments.every((p) => p.rail === "va"), String(pv.count))
  const ps = (await api("GET", "/admin/doit/payments?preset=custom&from=2026-10-01&to=2026-10-31&q=boundary")).json
  check("payments: search reference (case-insensitive)", ps.count === 1 && ps.payments[0].reference === "INV/BOUNDARY")
  const pl = (await api("GET", "/admin/doit/payments?preset=custom&from=2026-10-01&to=2026-10-31&q=%25")).json
  check("payments: % in search is literal, not a wildcard", pl.count === 0, String(pl.count))
  check("payments: bad status → 400", (await api("GET", "/admin/doit/payments?status=cc")).status === 400)

  // export
  const ex = await fetch(`${BASE}/admin/doit/payments/export?preset=custom&from=2026-10-01&to=2026-10-31`, { headers: { authorization: `Bearer ${ctx.token}`, accept: "text/csv" } })
  const csv = await ex.text()
  const lines = csv.replace(/^﻿/, "").trim().split("\r\n")
  check("export: text/csv attachment with all filtered rows", ex.headers.get("content-type")?.startsWith("text/csv") && /attachment; filename="doit-transaksi-2026-10-01_2026-10-31.csv"/.test(ex.headers.get("content-disposition") ?? "") && lines.length === testOct.length + 1, `${lines.length - 1} rows`)
  check("export: local Jakarta time + flags", csv.includes("2026-10-26 00:30:00") && csv.includes("bayar_telat"))

  // withdrawals
  const w1 = await api("POST", "/admin/doit/withdrawals", { date: "2026-10-24", amount: 1000000, fee_amount: 10000, note: "Pencairan Oktober" })
  check("manual withdrawal created", w1.status === 200 && w1.json.created.length === 1, JSON.stringify(w1.json))
  check("bad withdrawal (fractional / zero) → 400", (await api("POST", "/admin/doit/withdrawals", { date: "2026-10-24", amount: 10.5 })).status === 400 && (await api("POST", "/admin/doit/withdrawals", { date: "2026-10-24", amount: 0 })).status === 400)
  const st2 = (await api("GET", "/admin/doit/stats?preset=custom&from=2026-10-01&to=2026-10-31")).json.stats
  check("withdraw card and balance include amount + fee", st2.withdrawals.amount === 1010000 && st2.balance.estimate === exp.balanceNet - exp.refunded - 1010000, JSON.stringify({ w: st2.withdrawals, b: st2.balance.estimate }))
  const csvText = "ID Settlement;Tanggal;Nominal (Rp);Biaya;Status\nstl_001;20/10/2026;Rp2.000.000;Rp10.000;Selesai\nstl_002;21/10/2026;Rp500.000;;Gagal\nstl_003;22/10/2026;Rp750.000,00;Rp10.000;Selesai\nstl_004;salah;Rp1;;Selesai\n"
  const dry = (await api("POST", "/admin/doit/withdrawals/import", { csv: csvText, dry_run: true })).json
  check("CSV dry run: 2 new rows, 1 skipped (Gagal), 1 error, nothing written", dry.dry_run && dry.new_rows === 2 && dry.skipped.length === 1 && dry.errors.length === 1 && dry.new_amount === 2770000 && (await count("select count(*) n from doit_withdrawal where source='csv'")) === 0, JSON.stringify({ n: dry.new_rows, s: dry.skipped.length, e: dry.errors.length, a: dry.new_amount }))
  const imp = (await api("POST", "/admin/doit/withdrawals/import", { csv: csvText, dry_run: false })).json
  check("CSV import: 2 created, settlement id column detected", imp.created === 2 && imp.columns.ref === "ID Settlement", JSON.stringify(imp).slice(0, 160))
  check("CSV rows keep the settlement id as external_ref", (await sql("select external_ref from doit_withdrawal where source='csv' order by date")).map((r) => r.external_ref).join(",") === "csv:stl_001,csv:stl_003")
  const again = await api("POST", "/admin/doit/withdrawals/import", { csv: csvText, dry_run: true })
  check("CSV re-import: 0 new, 2 already imported", again.json.new_rows === 0 && again.json.duplicate_rows === 2)
  check("CSV re-import commit refused (nothing new) → 400", (await api("POST", "/admin/doit/withdrawals/import", { csv: csvText, dry_run: false })).status === 400)
  const wl = (await api("GET", "/admin/doit/withdrawals")).json
  check("withdrawals list: 3 (1 manual + 2 csv), newest date first", wl.count === 3 && wl.withdrawals[0].date === "2026-10-24", JSON.stringify(wl.withdrawals.map((w) => w.date)))
  const del = await api("DELETE", `/admin/doit/withdrawals/${w1.json.created[0]}`)
  check("delete withdrawal", del.status === 200 && (await api("GET", "/admin/doit/withdrawals")).json.count === 2)

  // attention
  const at = (await api("GET", "/admin/doit/attention?status=open")).json
  check("attention: 2 open items", at.count === 2, String(at.count))
  const res = await api("POST", `/admin/doit/attention/doitatt_s1/resolve`, { status: "resolved", note: "Kelebihan Rp150.000 sudah direfund via portal." })
  check("attention resolve with note + admin user id", res.status === 200 && res.json.item.status === "resolved" && /^user_/.test(res.json.item.resolved_by ?? "") && res.json.item.resolution_note.includes("direfund"), JSON.stringify(res.json).slice(0, 200))
  check("resolving twice → 400", (await api("POST", `/admin/doit/attention/doitatt_s1/resolve`, {})).status === 400)
  check("attention: 1 open left; resolved list shows it", (await api("GET", "/admin/doit/attention?status=open")).json.count === 1 && (await api("GET", "/admin/doit/attention?status=resolved")).json.items[0]?.id === "doitatt_s1")
  check("unknown attention id → 404", (await api("POST", `/admin/doit/attention/doitatt_nope/resolve`, {})).status === 404)
})
