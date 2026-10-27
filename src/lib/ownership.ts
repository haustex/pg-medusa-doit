import type { Knex } from "@medusajs/framework/mikro-orm/knex"
import type { DoitEnvironment } from "./credentials"

/**
 * Which doit.id payments belong to this store.
 *
 * One doit.id app (API key) can be shared by several systems: another shop,
 * a staging copy of this Medusa, the portal's own payment links. Its
 * GET /v1/payments and its webhooks include all of them. Every payment the
 * plugin creates carries `metadata.medusa_store_id` (this Medusa's store id),
 * and reconciliation (sync job, webhooks, refunds) only touches payments with
 * that marker. Everything else is ignored: not written to the ledger, not
 * settled and never raised as "perlu tindakan".
 */

export const STORE_MARKER_KEY = "medusa_store_id"

const SESSION_ID = /payses_[0-9A-Za-z]+$/

/** doit.id `reference` for a payment session: optional prefix + session id. */
export function referenceFor(sessionId: string, prefix = ""): string {
  return `${prefix}${sessionId}`.slice(0, 128)
}

/** The Medusa payment session id inside a reference, whatever prefix was in use. */
export function sessionIdFromReference(reference: unknown): string | null {
  if (typeof reference !== "string") {
    return null
  }
  return reference.match(SESSION_ID)?.[0] ?? null
}

/** doit.id says "test" / "live" (older payloads "sandbox" / "production"). */
export function environmentOfPayment(value: unknown): DoitEnvironment | null {
  if (value === "test" || value === "sandbox") return "sandbox"
  if (value === "live" || value === "production") return "production"
  return null
}

export type OwnershipContext = {
  /** this Medusa's store id; null if it could not be read */
  storeId: string | null
  /** environment of the API key in use (sandbox / production) */
  keyEnvironment: DoitEnvironment | null
  /** payments created before this are ignored */
  ignoreBefore: Date | null
}

export type IgnoreReason = "other_store" | "environment" | "before_cutoff" | "unmarked"

export type Ownership =
  | { ours: true }
  /** made by plugin 0.1.0/0.1.1 (no store marker): ours only if its session exists in this Medusa */
  | { ours: "legacy"; sessionId: string }
  | { ours: false; reason: IgnoreReason }

type PaymentLike = {
  reference?: unknown
  environment?: unknown
  created_at?: unknown
  metadata?: Record<string, unknown> | null
}

export function classifyPayment(p: PaymentLike, ctx: OwnershipContext): Ownership {
  const env = environmentOfPayment(p.environment)
  if (ctx.keyEnvironment && env && env !== ctx.keyEnvironment) {
    return { ours: false, reason: "environment" }
  }
  const created = typeof p.created_at === "string" ? Date.parse(p.created_at) : NaN
  if (ctx.ignoreBefore && Number.isFinite(created) && created < ctx.ignoreBefore.getTime()) {
    return { ours: false, reason: "before_cutoff" }
  }
  const marker = p.metadata?.[STORE_MARKER_KEY]
  if (typeof marker === "string" && marker) {
    return ctx.storeId && marker !== ctx.storeId ? { ours: false, reason: "other_store" } : { ours: true }
  }
  // Before 0.1.2 payments only had the session id (in metadata and as the reference).
  const legacySession =
    (typeof p.metadata?.medusa_payment_session_id === "string" && p.metadata.medusa_payment_session_id) ||
    sessionIdFromReference(p.reference)
  if (legacySession) {
    return { ours: "legacy", sessionId: legacySession }
  }
  return { ours: false, reason: "unmarked" }
}

const STORE_ID_KEY = Symbol.for("medusa-payment-doit.store-id")
type StoreIdHolder = { [STORE_ID_KEY]?: Promise<string | null> }

/**
 * This Medusa's store id (the oldest store row), read once per process through
 * the shared connection, so the payment provider (which cannot resolve other
 * modules) and the plugin's own code agree on it.
 */
export function storeIdOf(pg: Knex | undefined): Promise<string | null> {
  if (!pg) {
    return Promise.resolve(null)
  }
  const holder = globalThis as StoreIdHolder
  if (!holder[STORE_ID_KEY]) {
    const pending: Promise<string | null> = pg("store")
      .select("id")
      .whereNull("deleted_at")
      .orderBy("created_at", "asc")
      .first()
      .then((row: { id?: string } | undefined) => row?.id ?? null)
      .catch(() => null)
    holder[STORE_ID_KEY] = pending
    // do not cache a miss (e.g. before migrations ran)
    pending.then((id) => {
      if (!id) delete holder[STORE_ID_KEY]
    })
  }
  return holder[STORE_ID_KEY]!
}
