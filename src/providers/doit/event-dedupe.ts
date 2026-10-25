/**
 * Remembers webhook event ids (`evt_…`) that were already accepted, so a
 * redelivery from doit.id is answered 200 without being queued again.
 *
 * Phase 1: in-memory, per server process, 24 h / 10 000 ids. Correctness does
 * not depend on it (capture is idempotent and the webhook handler checks the
 * Medusa payment state); the ledger's unique event id replaces it in phase 2.
 */
const DEFAULT_TTL_MS = 24 * 60 * 60 * 1000
const MAX_ENTRIES = 10_000

const STORE_KEY = Symbol.for("medusa-payment-doit.webhook-event-ids")
type StoreHolder = { [STORE_KEY]?: Map<string, number> }

function store(): Map<string, number> {
  const holder = globalThis as StoreHolder
  return (holder[STORE_KEY] ??= new Map())
}

export function wasEventSeen(eventId: string, now = Date.now()): boolean {
  const expiresAt = store().get(eventId)
  if (expiresAt === undefined) {
    return false
  }
  if (expiresAt <= now) {
    store().delete(eventId)
    return false
  }
  return true
}

export function markEventSeen(eventId: string, now = Date.now(), ttlMs = DEFAULT_TTL_MS): void {
  const ids = store()
  ids.delete(eventId)
  ids.set(eventId, now + ttlMs)
  // Map keeps insertion order, so the first keys are the oldest.
  while (ids.size > MAX_ENTRIES) {
    ids.delete(ids.keys().next().value as string)
  }
}

export function clearSeenEvents(): void {
  store().clear()
}
