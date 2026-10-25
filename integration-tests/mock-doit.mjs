// Minimal doit.id PayBridge stand-in for the E2E suites. Listens on 127.0.0.1 only.
// Behaviour follows https://doit.id/docs/ and what the sandbox answered (2026-10-25).
// Test-only control routes: GET /_log, POST /_seed, POST /_set/<payment id>.
import http from "node:http"

const port = Number(process.argv[2] || 9399)
const payments = new Map()
const idem = new Map()
const log = []
let seq = 0

const METHODS = [
  { code: "qris", label: "QRIS", rail: "qris", bank: null, fee_flat: 0, fee_pct: 0.7, fee_payer: "merchant", min_amount: 1000, max_amount: 10000000 },
  { code: "va_bmri", label: "Mandiri Virtual Account", rail: "va", bank: "bmri", fee_flat: 4000, fee_pct: 0, fee_payer: "customer", min_amount: null, max_amount: null },
  { code: "va_bnia", label: "BNI Virtual Account", rail: "va", bank: "bnia", fee_flat: 3000, fee_pct: 0, fee_payer: "customer", min_amount: null, max_amount: null },
  // Present in the sandbox, not in the docs: the plugin must hide it.
  { code: "cc", label: "Kartu kredit", rail: "cc", bank: null, fee_flat: 0, fee_pct: 2.9, fee_payer: "customer", min_amount: null, max_amount: null },
]
const feeOf = (m, amount) => Math.round(m.fee_flat + (amount * m.fee_pct) / 100)

const send = (res, status, body) => {
  res.writeHead(status, { "content-type": "application/json" })
  res.end(JSON.stringify(body))
}
const err = (res, status, code, message) => send(res, status, { error: { code, message, doc_url: `https://doit.id/docs/#err-${code}` } })

http
  .createServer(async (req, res) => {
    let raw = ""
    for await (const c of req) raw += c
    let body
    try {
      body = raw ? JSON.parse(raw) : undefined
    } catch {
      return err(res, 400, "invalid_json", "body is not JSON")
    }
    const url = new URL(req.url, "http://x")
    log.push({ method: req.method, path: url.pathname, query: url.search, idem: req.headers["idempotency-key"] ?? null, auth: (req.headers.authorization || "").slice(0, 15), body })

    if (url.pathname === "/_log") return send(res, 200, log)
    if (url.pathname === "/_seed") {
      // a payment made outside Medusa (e.g. a portal payment link)
      const id = `pay_seed${++seq}`
      const now = new Date().toISOString()
      const p = { id, status: "paid", amount: 25000, rail: "qris", reference: "INV/PORTAL", fee_amount: 0, fee_payer: "merchant", total_amount: 25000, environment: "test", flags: [], created_at: now, paid_at: now, ...body }
      payments.set(id, p)
      return send(res, 201, p)
    }
    if (url.pathname.startsWith("/_set/")) {
      const p = payments.get(url.pathname.slice(6))
      if (!p) return err(res, 404, "payment_not_found", "nope")
      Object.assign(p, body)
      return send(res, 200, p)
    }

    if (!/^Bearer pb_(test|live)_/.test(req.headers.authorization || "")) return err(res, 401, "unauthorized", "bad key")
    if (req.method === "POST" && !req.headers["idempotency-key"]) return err(res, 400, "missing_idempotency_key", "need key")
    const key = `${req.method} ${url.pathname} ${req.headers["idempotency-key"]}`
    if (req.method === "POST" && idem.has(key)) return send(res, 200, idem.get(key))

    let m
    if (req.method === "POST" && url.pathname === "/v1/payments") {
      const id = `pay_mock${++seq}`
      const method = METHODS.find((x) => x.rail === body.rail && (x.bank ?? null) === (body.va_bank ?? null)) ?? METHODS[0]
      const fee = feeOf(method, body.amount)
      const p = {
        id, status: "pending", amount: body.amount, rail: body.rail, reference: body.reference,
        qr_content: body.rail === "qris" ? `00020101021226MOCKQR${id}5303360540${String(body.amount).length}${body.amount}6304ABCD` : null,
        va_number: body.rail === "va" ? `8808000000${String(seq).padStart(4, "0")}` : null, va_bank: body.va_bank ?? null,
        hosted_url: `https://pay.doit.id/p/${id}`, return_url: body.return_url ?? null,
        fee_amount: fee, fee_payer: method.fee_payer, total_amount: body.amount + (method.fee_payer === "customer" ? fee : 0), environment: "test",
        expires_at: new Date(Date.now() + (body.expires_in ?? 86400) * 1000).toISOString(), paid_at: null,
        metadata: body.metadata ?? null, flags: [], customer: body.customer ?? null, created_at: new Date().toISOString(),
      }
      payments.set(id, p)
      idem.set(key, p)
      return send(res, 201, p)
    }
    if (req.method === "GET" && url.pathname === "/v1/methods") {
      if ((req.headers.authorization || "").includes("pb_test_REVOKED")) return err(res, 401, "invalid_api_key", "API key tidak dikenal")
      const amount = url.searchParams.has("amount") ? Number(url.searchParams.get("amount")) : null
      const data = METHODS.map((x) => {
        if (amount === null) return x
        const fee = feeOf(x, amount)
        const within = (x.min_amount === null || amount >= x.min_amount) && (x.max_amount === null || amount <= x.max_amount)
        return { ...x, fee_amount: fee, total_amount: amount + (x.fee_payer === "customer" ? fee : 0), within_limits: within, limit: within ? null : `maks Rp${x.max_amount}` }
      })
      return send(res, 200, { environment: "test", amount, data })
    }
    if (req.method === "GET" && url.pathname === "/v1/payments") {
      const limit = Math.min(Number(url.searchParams.get("limit") || 25), 100)
      const before = url.searchParams.get("before")
      let list = [...payments.values()].sort((a, b) => b.created_at.localeCompare(a.created_at))
      if (before) list = list.filter((p) => p.created_at < before)
      for (const k of ["status", "reference"]) if (url.searchParams.get(k)) list = list.filter((p) => p[k] === url.searchParams.get(k))
      return send(res, 200, { data: list.slice(0, limit) })
    }
    if (req.method === "GET" && (m = url.pathname.match(/^\/v1\/payments\/([^/]+)$/))) {
      const p = payments.get(m[1])
      return p ? send(res, 200, p) : err(res, 404, "payment_not_found", "nope")
    }
    if (req.method === "POST" && (m = url.pathname.match(/^\/v1\/payments\/([^/]+)\/refunds$/))) {
      const p = payments.get(m[1])
      if (!p) return err(res, 404, "payment_not_found", "nope")
      if (p.status !== "paid") return err(res, 409, "payment_not_refundable", `Refund hanya untuk status paid; status sekarang ${p.status}.`)
      const r = { id: `rf_mock${++seq}`, payment_id: p.id, amount: body?.amount ?? p.amount, status: "succeeded", reason: body?.reason ?? null }
      idem.set(key, r)
      return send(res, 201, r)
    }
    err(res, 404, "not_found", url.pathname)
  })
  .listen(port, "127.0.0.1", () => console.log(`mock doit on 127.0.0.1:${port}`))
