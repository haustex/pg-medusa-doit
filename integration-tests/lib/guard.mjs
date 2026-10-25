// Spike guard for the E2E suites. This host also runs a production store
// (Postgres 5432, Redis 6379, Medusa 9000): the suites only ever touch the
// spike containers (127.0.0.1:55432 / 127.0.0.1:56379) and ports 9300+.
import net from "node:net"

const LOCAL = new Set(["127.0.0.1", "localhost"])
export const SPIKE_PG_PORT = "55432"
export const SPIKE_REDIS_PORT = "56379"
/** Databases the runner may drop and recreate. */
export const E2E_DB_PATTERN = /^doit_e2e[a-z0-9_]*$/

function parse(name) {
  const raw = process.env[name]
  if (!raw) throw new Error(`${name} is not set. Example: ${name === "DATABASE_URL" ? "postgres://postgres:spike@127.0.0.1:55432/doit_e2e" : "redis://127.0.0.1:56379"}`)
  try {
    return new URL(raw)
  } catch {
    throw new Error(`${name} is not a valid URL`)
  }
}

/** Throws unless DATABASE_URL / REDIS_URL point at the spike containers. */
export function assertSpikeEnv() {
  const db = parse("DATABASE_URL")
  if (!LOCAL.has(db.hostname) || db.port !== SPIKE_PG_PORT) {
    throw new Error(`DATABASE_URL points at ${db.hostname}:${db.port || "5432"}; only 127.0.0.1:${SPIKE_PG_PORT} is allowed`)
  }
  const name = decodeURIComponent(db.pathname.slice(1))
  if (!E2E_DB_PATTERN.test(name)) {
    throw new Error(`DATABASE_URL database "${name}" must match ${E2E_DB_PATTERN} (it is dropped and recreated)`)
  }
  const redis = parse("REDIS_URL")
  if (!LOCAL.has(redis.hostname) || redis.port !== SPIKE_REDIS_PORT) {
    throw new Error(`REDIS_URL points at ${redis.hostname}:${redis.port || "6379"}; only 127.0.0.1:${SPIKE_REDIS_PORT} is allowed`)
  }
  for (const key of ["DB_HOST", "DB_PORT"]) {
    if (process.env[key] && !["127.0.0.1", "localhost", SPIKE_PG_PORT].includes(process.env[key])) {
      throw new Error(`${key}=${process.env[key]} would override DATABASE_URL`)
    }
  }
  return { db, dbName: name, redis }
}

/** Throws when a port is below 9300 or already in use. */
export async function assertPortFree(port) {
  if (port < 9300) throw new Error(`port ${port} is below 9300; the E2E suites only use 9300+`)
  const free = await new Promise((resolve) => {
    const s = net.createServer().once("error", () => resolve(false)).once("listening", () => s.close(() => resolve(true)))
    s.listen(port, "127.0.0.1")
  })
  if (!free) throw new Error(`port ${port} is in use; aborting`)
}
