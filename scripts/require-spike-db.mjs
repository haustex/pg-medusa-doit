// Guard for every medusa / plugin:db command run on this host: the same machine
// runs a production store whose Postgres (5432) and Redis (6379) must never be
// touched. Aborts unless DATABASE_URL is set and points at the spike container.
//
// Usage: node scripts/require-spike-db.mjs <command> [args…]
// The command runs with DB_HOST / DB_PORT / DB_USERNAME / DB_PASSWORD derived
// from DATABASE_URL: `medusa plugin:db:generate` passes host=localhost,
// port=5432 explicitly, and those win over DATABASE_URL unless overridden.
import { spawnSync } from "node:child_process"
const ALLOWED_PORTS = new Set(["55432"])
const ALLOWED_HOSTS = new Set(["127.0.0.1", "localhost"])

const raw = process.env.DATABASE_URL
if (!raw) {
  console.error("Aborted: DATABASE_URL is not set. Point it at the doit-spike-pg container (127.0.0.1:55432).")
  process.exit(1)
}
let url
try {
  url = new URL(raw)
} catch {
  console.error("Aborted: DATABASE_URL is not a valid URL.")
  process.exit(1)
}
if (!ALLOWED_HOSTS.has(url.hostname) || !ALLOWED_PORTS.has(url.port)) {
  console.error(`Aborted: DATABASE_URL points at ${url.hostname}:${url.port || "5432"}; only 127.0.0.1:55432 (doit-spike-pg) is allowed.`)
  process.exit(1)
}
for (const key of ["DB_HOST", "DB_PORT"]) {
  if (process.env[key] && !["127.0.0.1", "localhost", "55432"].includes(process.env[key])) {
    console.error(`Aborted: ${key}=${process.env[key]} would override DATABASE_URL.`)
    process.exit(1)
  }
}
if (process.env.DB_HOST === "localhost" || process.env.DB_PORT === "5432") {
  console.error("Aborted: DB_HOST/DB_PORT point at the default localhost:5432.")
  process.exit(1)
}
const redis = process.env.REDIS_URL
if (redis && /:6379(\/|$)/.test(redis)) {
  console.error("Aborted: REDIS_URL points at port 6379 (production Redis).")
  process.exit(1)
}
console.log(`DB guard ok: ${url.hostname}:${url.port}${url.pathname}`)

const [command, ...args] = process.argv.slice(2)
if (command) {
  const result = spawnSync(command, args, {
    stdio: "inherit",
    shell: false,
    env: {
      ...process.env,
      DB_HOST: url.hostname,
      DB_PORT: url.port,
      DB_USERNAME: decodeURIComponent(url.username),
      DB_PASSWORD: decodeURIComponent(url.password),
    },
  })
  process.exit(result.status ?? 1)
}
