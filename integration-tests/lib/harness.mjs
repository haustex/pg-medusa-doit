// Shared helpers for the E2E suites: processes, HTTP, webhooks, SQL, checks.
import { spawn } from "node:child_process"
import crypto from "node:crypto"
import fs from "node:fs"
import { createRequire } from "node:module"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { assertPortFree, assertSpikeEnv } from "./guard.mjs"

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
export const APP_DIR = path.join(ROOT, "app")
export const MOCK_SCRIPT = path.join(ROOT, "mock-doit.mjs")
export const PORTS = { server: 9300, worker: 9301, mock: 9399 }
export const BASE = `http://127.0.0.1:${PORTS.server}`
export const MOCK_URL = `http://127.0.0.1:${PORTS.mock}`
export const ADMIN = { email: "admin@e2e.test", password: "e2e-pass-123" }

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
export const randomHex = (n) => crypto.randomBytes(n).toString("hex")

// ---------------------------------------------------------------- checks

const results = []
export function check(name, ok, detail = "") {
  results.push({ name, ok: !!ok })
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  — ${detail}` : ""}`)
}
export const info = (msg) => console.log(`INFO  ${msg}`)

// ---------------------------------------------------------------- processes

const procs = []
export function logDir(suite) {
  const dir = path.resolve(process.env.E2E_LOG_DIR || path.join(ROOT, ".logs"), suite)
  fs.mkdirSync(dir, { recursive: true })
  return dir
}

export function start(dir, label, cmd, args, env = {}, cwd = APP_DIR) {
  const logFile = path.join(dir, `${label}.log`)
  const fd = fs.openSync(logFile, "w")
  const child = spawn(cmd, args, { cwd, env: { ...process.env, ...env }, stdio: ["ignore", fd, fd], detached: true })
  const p = { child, label, log: () => fs.readFileSync(logFile, "utf8") }
  procs.push(p)
  return p
}

export async function stopAll() {
  for (const p of procs) {
    try { process.kill(-p.child.pid, "SIGTERM") } catch {}
  }
  await sleep(1500)
  for (const p of procs) {
    try { process.kill(-p.child.pid, "SIGKILL") } catch {}
  }
}

export async function waitFor(fn, ms, step = 1000) {
  const end = Date.now() + ms
  while (Date.now() < end) {
    try {
      const v = await fn()
      if (v) return v
    } catch {}
    await sleep(step)
  }
  return null
}

export const fakeCredentials = () => ({
  apiKey: `pb_test_FAKE${randomHex(12)}`,
  secret: `whsec_${crypto.randomBytes(18).toString("base64url")}`,
})

/**
 * Starts mock doit.id (optional) + Medusa as separate server (:9300) and worker
 * (:9301) processes, like a production deployment. Returns once /health is up.
 */
export async function startStack(dir, { env = {}, mock = true, split = true } = {}) {
  assertSpikeEnv()
  for (const port of [PORTS.server, ...(split ? [PORTS.worker] : []), ...(mock ? [PORTS.mock] : [])]) await assertPortFree(port)
  const common = { NODE_ENV: "development", DOIT_ENCRYPTION_KEY: randomHex(32), ...(mock ? { DOIT_API_BASE_URL: MOCK_URL } : {}), ...env }
  if (mock) start(dir, "mock", "node", [MOCK_SCRIPT, String(PORTS.mock)])
  const server = start(dir, "server", "npx", ["medusa", "start"], { ...common, MEDUSA_WORKER_MODE: split ? "server" : "shared", PORT: String(PORTS.server) })
  const worker = split ? start(dir, "worker", "npx", ["medusa", "start"], { ...common, MEDUSA_WORKER_MODE: "worker", PORT: String(PORTS.worker) }) : server
  const up = await waitFor(async () => (await fetch(`${BASE}/health`)).ok, 180_000)
  if (split && up) await waitFor(async () => /ready|Server is ready/i.test(worker.log()), 60_000)
  return { up: !!up, server, worker }
}

// ---------------------------------------------------------------- HTTP

export const ctx = { token: null, pk: null }

/** opts.pk overrides the publishable key; `pk: null` sends none. */
export async function api(method, p, body, opts = {}) {
  const { store = false, auth = true, headers = {} } = opts
  const pk = "pk" in opts ? opts.pk : ctx.pk
  const h = { "content-type": "application/json", ...headers }
  if (store) {
    if (pk) h["x-publishable-api-key"] = pk
  } else if (auth && ctx.token) {
    h.authorization = `Bearer ${ctx.token}`
  }
  const res = await fetch(BASE + p, { method, headers: h, body: body ? JSON.stringify(body) : undefined })
  const text = await res.text()
  let json
  try { json = JSON.parse(text) } catch { json = text }
  return { status: res.status, json, text, headers: res.headers }
}

export async function login() {
  const res = await fetch(`${BASE}/auth/user/emailpass`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(ADMIN) })
  ctx.token = (await res.json()).token
  return ctx.token
}

/** Publishable key on the default sales channel, region Indonesia (IDR) with doit, one product at Rp150.000. */
export async function setupStore({ price = 150000, extraRegions = [] } = {}) {
  const sc = (await api("GET", "/admin/sales-channels")).json.sales_channels[0]
  const key = (await api("POST", "/admin/api-keys", { title: "e2e", type: "publishable" })).json.api_key
  await api("POST", `/admin/api-keys/${key.id}/sales-channels`, { add: [sc.id] })
  ctx.pk = key.token
  const region = (await api("POST", "/admin/regions", { name: "Indonesia", currency_code: "idr", countries: ["id"], payment_providers: ["pp_doit_doit"] })).json.region
  const regions = {}
  for (const r of extraRegions) regions[r.currency_code] = (await api("POST", "/admin/regions", { ...r, payment_providers: ["pp_doit_doit"] })).json.region
  const product = (await api("POST", "/admin/products", {
    title: "Kursi Jati", status: "published", sales_channels: [{ id: sc.id }],
    options: [{ title: "Ukuran", values: ["Std"] }],
    variants: [{ title: "Std", options: { Ukuran: "Std" }, manage_inventory: false, prices: [{ currency_code: "idr", amount: price }, { currency_code: "usd", amount: 10 }] }],
  })).json.product
  return { sc, pk: key.token, region, regions, variantId: product?.variants?.[0]?.id }
}

export async function newCart(regionId, variantId, { data = {}, email = "budi@e2e.test", headers = {} } = {}) {
  const cart = (await api("POST", "/store/carts", { region_id: regionId, email, items: [{ variant_id: variantId, quantity: 1 }] }, { store: true, headers })).json.cart
  const pc = (await api("POST", "/store/payment-collections", { cart_id: cart.id }, { store: true, headers })).json.payment_collection
  const ses = await api("POST", `/store/payment-collections/${pc.id}/payment-sessions`, { provider_id: "pp_doit_doit", data }, { store: true, headers })
  return { cart, pc, ses, session: ses.json.payment_collection?.payment_sessions?.[0] }
}

export const cartDone = async (id) => (await api("GET", `/store/carts/${id}`, null, { store: true })).json.cart?.completed_at

// ---------------------------------------------------------------- webhooks

export function sign(raw, secret, t = Math.floor(Date.now() / 1000)) {
  return `t=${t},v1=${crypto.createHmac("sha256", secret).update(`${t}.${raw}`).digest("hex")}`
}

/** opts: raw (body bytes), header (null = omit, string = use as-is), secret, t */
export async function webhook(event, secret, opts = {}, providerPath = "doit_doit") {
  const raw = opts.raw ?? JSON.stringify(event)
  const headers = { "content-type": "application/json" }
  if (opts.header !== null) headers["paybridge-signature"] = opts.header ?? sign(raw, opts.secret ?? secret, opts.t)
  const res = await fetch(`${BASE}/hooks/payment/${providerPath}`, { method: "POST", headers, body: raw })
  return { status: res.status, body: await res.text() }
}

export const evtId = (prefix = "") => `evt_${prefix}${randomHex(5)}`

// ---------------------------------------------------------------- mock doit.id

export const mockLog = async () => (await fetch(`${MOCK_URL}/_log`)).json()
export const mockSet = async (id, patch) => (await fetch(`${MOCK_URL}/_set/${id}`, { method: "POST", body: JSON.stringify(patch) })).json()
export const mockSeed = async (body = {}) => (await fetch(`${MOCK_URL}/_seed`, { method: "POST", body: JSON.stringify(body) })).json()
export const mockPayment = async (id, apiKey) => (await fetch(`${MOCK_URL}/v1/payments/${id}`, { headers: { authorization: `Bearer ${apiKey}` } })).json()

// ---------------------------------------------------------------- SQL

let pool
function pg() {
  if (!pool) {
    assertSpikeEnv()
    const { Pool } = createRequire(path.join(APP_DIR, "package.json"))("pg")
    pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 2 })
  }
  return pool
}
/** Rows of a single query. */
export async function sql(q, params = []) {
  return (await pg().query(q, params)).rows
}
/** Runs a script of several statements. */
export async function sqlScript(text) {
  await pg().query(text)
}

// ---------------------------------------------------------------- runner

export async function runSuite(main) {
  try {
    await main()
  } catch (e) {
    check("suite crashed", false, e.stack)
  } finally {
    await stopAll()
    await pool?.end().catch(() => {})
    const failed = results.filter((r) => !r.ok)
    console.log(`\n${results.length - failed.length}/${results.length} passed`)
    process.exit(failed.length ? 1 : 0)
  }
}
