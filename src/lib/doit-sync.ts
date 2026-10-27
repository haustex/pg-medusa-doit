import crypto from "node:crypto"
import type { MedusaContainer } from "@medusajs/framework/types"
import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils"
import { DOIT_LEDGER_MODULE } from "../modules/doitLedger"
import type DoitLedgerModuleService from "../modules/doitLedger/service"
import { DoitClient } from "../providers/doit/client"
import type { DoitPayment } from "../providers/doit/types"
import { excludeDoitPaymentsWorkflow } from "../workflows/exclude-doit-payments"
import { recordDoitLedgerWorkflow } from "../workflows/record-doit-ledger"
import { saveDoitSyncStateWorkflow } from "../workflows/save-doit-sync-state"
import { resolveDoitCredentials, type DoitProviderOptions } from "./credentials"
import { settlePaidPayment } from "./doit-processing"
import { attention, toLedgerPayment } from "./ledger"
import { DOIT_PROVIDER_IDENTIFIER } from "./provider-options"
import type { OwnershipContext } from "./ownership"
import { ownershipContext, partitionOurs } from "./reconcile-scope"

export const PAGE_SIZE = 100
/** Pages per run: 2 000 payments, well inside 120 requests/minute with the limiter. */
export const MAX_PAGES = 20
/** Re-read this much before the stored high-water mark (late writes, clock skew). */
export const CURSOR_OVERLAP_MS = 15 * 60 * 1000
/** First run without a cursor goes back this far. */
export const INITIAL_LOOKBACK_MS = 30 * 24 * 60 * 60 * 1000
/** Expired payments are re-read this long after expiry: they can still turn paid (bayar_telat). */
export const EXPIRED_RECHECK_MS = 3 * 24 * 60 * 60 * 1000
export const MAX_RECHECKS = 100
export const MAX_RECONCILES = 50
/** A webhook still "received" with errors after this long is reported (local event bus has no retries). */
export const STALE_EVENT_MS = 30 * 60 * 1000
const LOCK_SECONDS = 14 * 60

type Logger = { info: (m: string) => void; warn: (m: string) => void; error: (m: string) => void }

export type SyncStats = {
  provider: string
  skipped?: string
  pages: number
  scanned: number
  rechecked: number
  reconciled: number
  reconcile_errors: number
  attentions: number
  stale_events: number
  /** payments of other apps / stores, the other mode or from before the cutoff */
  ignored: number
  /** open "perlu tindakan" items dismissed because their payment is not this store's */
  dismissed: number
  /** one-time ledger cleanup after upgrading to 0.1.3 (only on the run that did it) */
  cleanup?: LedgerCleanupStats
}

export type LedgerCleanupStats = { checked: number; excluded: number; by_reason: Record<string, number> }

/** Sync-state key of the one-time ledger cleanup; a row with last_success_at means done. */
export const LEDGER_CLEANUP_KEY = "ledger-cleanup:v1"
const CLEANUP_BATCH = 500

type ProviderEntry = { id?: string; resolve?: unknown; options?: DoitProviderOptions }

/** doit providers registered in the Payment Module (normally one: id "doit"). */
export function doitProvidersFromConfig(config: {
  modules?: Record<string, unknown> | unknown[]
}): { id: string; options: DoitProviderOptions }[] {
  const modules = config.modules ?? {}
  const list = Array.isArray(modules) ? modules : Object.values(modules)
  const found: { id: string; options: DoitProviderOptions }[] = []
  for (const m of list) {
    const providers = (m as { options?: { providers?: ProviderEntry[] } })?.options?.providers
    for (const p of providers ?? []) {
      if (typeof p.resolve === "string" && p.resolve.includes("doit") && p.id) {
        found.push({ id: p.id, options: p.options ?? {} })
      }
    }
  }
  return found.length ? found : [{ id: DOIT_PROVIDER_IDENTIFIER, options: {} }]
}

function newestCreatedAt(payments: DoitPayment[]): Date | null {
  let max: number | null = null
  for (const p of payments) {
    const t = p.created_at ? Date.parse(p.created_at) : NaN
    if (Number.isFinite(t) && (max === null || t > max)) max = t
  }
  return max === null ? null : new Date(max)
}

function oldestCreatedAt(payments: DoitPayment[]): string | null {
  let min: { t: number; s: string } | null = null
  for (const p of payments) {
    const t = p.created_at ? Date.parse(p.created_at) : NaN
    if (Number.isFinite(t) && (min === null || t < min.t)) min = { t, s: p.created_at! }
  }
  return min?.s ?? null
}

/**
 * The 15-minute safety net behind webhooks:
 * 1. scan GET /v1/payments newest first down to the high-water mark (minus overlap);
 * 2. re-read pending / recently expired payments that the scan did not reach;
 * 3. settle paid payments that Medusa still has as pending (lost or failed webhooks);
 * 4. report webhooks stuck with errors.
 * One run at a time per provider through the Locking Module.
 */
export async function syncDoitPayments(
  container: MedusaContainer,
  { fetchImpl }: { fetchImpl?: typeof fetch } = {}
): Promise<SyncStats[]> {
  const config = container.resolve(ContainerRegistrationKeys.CONFIG_MODULE) as never
  const results: SyncStats[] = []
  for (const provider of doitProvidersFromConfig(config)) {
    results.push(await syncProvider(container, provider.id, provider.options, fetchImpl))
  }
  return results
}

async function syncProvider(
  container: MedusaContainer,
  providerId: string,
  options: DoitProviderOptions,
  fetchImpl?: typeof fetch
): Promise<SyncStats> {
  const log = container.resolve(ContainerRegistrationKeys.LOGGER) as Logger
  const stats: SyncStats = {
    provider: providerId,
    pages: 0,
    scanned: 0,
    rechecked: 0,
    reconciled: 0,
    reconcile_errors: 0,
    attentions: 0,
    stale_events: 0,
    ignored: 0,
    dismissed: 0,
  }

  const creds = await resolveDoitCredentials(
    container.resolve(ContainerRegistrationKeys.PG_CONNECTION),
    options,
    { logger: log }
  )
  if (!creds.apiKey) {
    return { ...stats, skipped: "no_api_key" }
  }

  const locking = container.resolve(Modules.LOCKING)
  const lockKey = `doit:sync-payments:${providerId}`
  const owner = crypto.randomUUID()
  try {
    await locking.acquire(lockKey, { ownerId: owner, expire: LOCK_SECONDS })
  } catch {
    log.info(`[doit] Sync ${providerId} already running elsewhere; skipped.`)
    return { ...stats, skipped: "locked" }
  }

  const scope = await ownershipContext(container, creds)
  const stateKey = `payments:${providerId}`
  const service = container.resolve(DOIT_LEDGER_MODULE) as DoitLedgerModuleService
  const runStart = new Date()
  try {
    const [state] = await service.listDoitSyncStates({ key: stateKey }, { take: 1 })
    // 0. once after upgrading: mark ledger rows that are not this store's as excluded
    const cleanup = await cleanupLedgerOnce(container, service, scope, log)
    if (cleanup) stats.cleanup = cleanup
    const client = new DoitClient({
      apiKey: creds.apiKey,
      baseUrl: options.api_base_url,
      timeoutMs: options.request_timeout_ms,
      // a background job can afford to wait out a Retry-After
      maxRetries: options.max_retries ?? 3,
      maxRetryWaitMs: Math.max(options.max_retry_wait_ms ?? 0, 60_000),
      fetch: fetchImpl,
    })

    // 1. scan
    const cursor = state?.cursor ? new Date(state.cursor) : null
    const stopAt = cursor
      ? cursor.getTime() - CURSOR_OVERLAP_MS
      : runStart.getTime() - INITIAL_LOOKBACK_MS
    let newest = cursor
    let before: string | undefined
    while (stats.pages < MAX_PAGES) {
      const { data } = await client.listPayments({ limit: PAGE_SIZE, before })
      stats.pages++
      if (!data?.length) break
      stats.scanned += data.length
      // Only this store's payments enter the ledger (see src/lib/ownership.ts).
      const { ours, ignored } = await partitionOurs(container, data, scope)
      stats.ignored += ignored.length
      if (ours.length) {
        await recordDoitLedgerWorkflow(container).run({
          input: {
            payments: ours.map((p) => toLedgerPayment(p, { last_synced_at: new Date(), authoritative: true })),
          },
        })
      }
      const pageNewest = newestCreatedAt(data)
      if (pageNewest && (!newest || pageNewest > newest)) newest = pageNewest
      const oldest = oldestCreatedAt(data)
      if (data.length < PAGE_SIZE || !oldest || Date.parse(oldest) <= stopAt || oldest === before) break
      before = oldest
    }

    // 2. re-read open payments the scan did not refresh
    const open = await service.listDoitPayments(
      { status: ["pending", "expired"], last_synced_at: { $lt: runStart }, excluded_at: null } as never,
      { take: MAX_RECHECKS * 2, order: { doit_created_at: "DESC" } }
    )
    const recheck = (await oursFromLedger(container, open, scope))
      .filter(
        (p) =>
          p.status === "pending" ||
          (p.expires_at && runStart.getTime() - new Date(p.expires_at).getTime() < EXPIRED_RECHECK_MS)
      )
      .slice(0, MAX_RECHECKS)
    for (const p of recheck) {
      try {
        const fresh = await client.getPayment(p.doit_id)
        await recordDoitLedgerWorkflow(container).run({
          input: { payments: [toLedgerPayment(fresh, { last_synced_at: new Date(), authoritative: true })] },
        })
        stats.rechecked++
      } catch (e) {
        log.warn(`[doit] Sync could not re-read ${p.doit_id}: ${(e as Error).message}`)
      }
    }

    // 3. settle paid payments Medusa has not caught up with
    const unsettledRows = await service.listDoitPayments(
      { status: "paid", reconciled_at: null, session_id: { $ne: null }, excluded_at: null } as never,
      { take: MAX_RECONCILES, order: { paid_at: "DESC" } }
    )
    // Rows that are not this store's (e.g. its session is gone and it carries no store
    // marker) are excluded instead of settled, so they stop coming back here.
    const { ours: unsettled, ignored: notOurs } = await partitionLedger(container, unsettledRows, scope)
    if (notOurs.length) {
      await excludeDoitPaymentsWorkflow(container).run({
        input: { exclusions: notOurs.map(({ row, reason }) => ({ doit_id: row.doit_id, reason })) },
      })
      stats.ignored += notOurs.length
    }
    for (const p of unsettled) {
      try {
        // Settle from doit.id's current answer, not from a webhook snapshot.
        const fresh = await client.getPayment(p.doit_id)
        if (fresh.status !== "paid") {
          await recordDoitLedgerWorkflow(container).run({
            input: { payments: [toLedgerPayment(fresh, { last_synced_at: new Date(), authoritative: true })] },
          })
          log.warn(`[doit] Sync: ${p.doit_id} was recorded as paid but doit.id says ${fresh.status}; ledger corrected.`)
          continue
        }
        const result = await settlePaidPayment(container, fresh, { options })
        await recordDoitLedgerWorkflow(container).run({
          input: { payments: [result.payment], attentions: result.attentions },
        })
        stats.attentions += result.attentions.length
        if (result.captured) {
          stats.reconciled++
          log.info(`[doit] Sync settled ${p.doit_id} (session ${p.session_id}) in Medusa.`)
        }
      } catch (e) {
        stats.reconcile_errors++
        log.warn(`[doit] Sync could not settle ${p.doit_id}: ${(e as Error).message}`)
      }
    }

    // 4. open "perlu tindakan" items raised for payments that are not this store's
    stats.dismissed = await dismissForeignAttentions(container, service, scope)

    // 5. webhooks stuck with errors (no retries configured, or the worker died mid-way)
    const stale = await service.listDoitEvents(
      { status: "received", attempts: { $gt: 0 }, updated_at: { $lt: new Date(runStart.getTime() - STALE_EVENT_MS) } } as never,
      { take: 100 }
    )
    for (const e of stale) {
      await recordDoitLedgerWorkflow(container).run({
        input: {
          event: {
            event_id: e.event_id,
            type: e.type,
            doit_payment_id: e.doit_payment_id,
            status: "failed",
            attempts: e.attempts,
            last_error: e.last_error,
          },
          attentions: [
            attention(
              "webhook_failed",
              e.event_id,
              `Webhook ${e.event_id} (${e.type}) macet setelah ${e.attempts} percobaan: ${(e.last_error ?? "").slice(0, 300)}`,
              { doit_payment_id: e.doit_payment_id, event_id: e.event_id }
            ),
          ],
        },
      })
      stats.stale_events++
    }

    await saveDoitSyncStateWorkflow(container).run({
      input: {
        key: stateKey,
        cursor: newest,
        last_run_at: runStart,
        last_success_at: new Date(),
        last_error: null,
        stats: stats as unknown as Record<string, unknown>,
      },
    })
    log.info(
      `[doit] Sync ${providerId}: ${stats.scanned} scanned in ${stats.pages} page(s), ${stats.ignored} not this store's, ${stats.rechecked} re-read, ${stats.reconciled} settled, ${stats.attentions} perlu tindakan, ${stats.dismissed} dismissed, ${stats.stale_events} stale webhook(s).`
    )
    return stats
  } catch (e) {
    const message = (e as Error).message
    log.error(`[doit] Sync ${providerId} failed: ${message}`)
    await saveDoitSyncStateWorkflow(container)
      .run({ input: { key: stateKey, last_run_at: runStart, last_error: message.slice(0, 2000) } })
      .catch(() => undefined)
    return { ...stats, skipped: "error" }
  } finally {
    await locking.release(lockKey, { ownerId: owner }).catch(() => undefined)
  }
}

type LedgerRow = Awaited<ReturnType<DoitLedgerModuleService["listDoitPayments"]>>[number]

/** Splits ledger rows by their stored doit.id payment: this store's, or not (with the reason). */
async function partitionLedger(
  container: MedusaContainer,
  rows: LedgerRow[],
  scope: OwnershipContext
): Promise<{ ours: LedgerRow[]; ignored: { row: LedgerRow; reason: string }[] }> {
  const asPayments = rows.map((r) => ({
    ...((r.raw ?? {}) as Record<string, unknown>),
    id: r.doit_id,
    reference: (r.raw as Record<string, unknown> | null)?.reference ?? r.reference,
    environment: (r.raw as Record<string, unknown> | null)?.environment ?? r.environment,
    row: r,
  }))
  const { ours, ignored } = await partitionOurs(container, asPayments, scope)
  return {
    ours: ours.map((p) => p.row),
    ignored: ignored.map(({ payment, reason }) => ({ row: payment.row, reason })),
  }
}

async function oursFromLedger(container: MedusaContainer, rows: LedgerRow[], scope: OwnershipContext): Promise<LedgerRow[]> {
  return (await partitionLedger(container, rows, scope)).ours
}

/**
 * Runs once per install (state LEDGER_CLEANUP_KEY): marks ledger rows written
 * by earlier versions for payments that are not this store's as excluded:
 * other apps or stores on the key, the other mode, or 0.1.0/0.1.1 payments
 * whose Medusa session is gone. Rows linked to an order are always kept. The
 * cutoff date is not a reason to exclude. Nothing is deleted.
 */
export async function cleanupLedgerOnce(
  container: MedusaContainer,
  service: DoitLedgerModuleService,
  scope: OwnershipContext,
  log: Logger
): Promise<LedgerCleanupStats | null> {
  const [done] = await service.listDoitSyncStates({ key: LEDGER_CLEANUP_KEY }, { take: 1 })
  if (done?.last_success_at) {
    return null
  }
  const started = new Date()
  const cleanupScope = { ...scope, ignoreBefore: null }
  const stats: LedgerCleanupStats = { checked: 0, excluded: 0, by_reason: {} }
  let after = ""
  for (;;) {
    const rows = await service.listDoitPayments(
      { id: { $gt: after }, excluded_at: null } as never,
      { take: CLEANUP_BATCH, order: { id: "ASC" } }
    )
    if (!rows.length) break
    after = rows[rows.length - 1].id
    stats.checked += rows.length
    const { ignored } = await partitionLedger(container, rows.filter((r) => !r.order_id), cleanupScope)
    if (ignored.length) {
      await excludeDoitPaymentsWorkflow(container).run({
        input: { exclusions: ignored.map(({ row, reason }) => ({ doit_id: row.doit_id, reason })) },
      })
      stats.excluded += ignored.length
      for (const { reason } of ignored) stats.by_reason[reason] = (stats.by_reason[reason] ?? 0) + 1
    }
    if (rows.length < CLEANUP_BATCH) break
  }
  await saveDoitSyncStateWorkflow(container).run({
    input: {
      key: LEDGER_CLEANUP_KEY,
      last_run_at: started,
      last_success_at: new Date(),
      last_error: null,
      stats: stats as unknown as Record<string, unknown>,
    },
  })
  log.info(
    `[doit] Ledger cleanup: ${stats.checked} row(s) checked, ${stats.excluded} excluded as not this store's ${JSON.stringify(stats.by_reason)}.`
  )
  return stats
}

/**
 * Closes open items raised (by earlier versions) for payments that are not
 * this store's: status "dismissed", with a note. Returns how many.
 */
async function dismissForeignAttentions(
  container: MedusaContainer,
  service: DoitLedgerModuleService,
  scope: OwnershipContext
): Promise<number> {
  const open = await service.listDoitAttentions({ status: "open" } as never, { take: 200 })
  const paymentIds = [...new Set(open.map((a) => a.doit_payment_id).filter((id): id is string => !!id))]
  if (!paymentIds.length) {
    return 0
  }
  const rows = await service.listDoitPayments({ doit_id: paymentIds } as never, { take: paymentIds.length })
  const ours = new Set((await oursFromLedger(container, rows, scope)).map((r) => r.doit_id))
  const known = new Set(rows.map((r) => r.doit_id))
  const foreign = open.filter((a) => a.doit_payment_id && known.has(a.doit_payment_id) && !ours.has(a.doit_payment_id))
  if (!foreign.length) {
    return 0
  }
  await recordDoitLedgerWorkflow(container).run({
    input: {
      resolve_attentions: foreign.map((a) => ({
        dedupe_key: a.dedupe_key,
        status: "dismissed" as const,
        note: "Diabaikan otomatis: bukan pembayaran toko ini (aplikasi/toko lain, mode test/live lain, atau sebelum tanggal batas).",
      })),
    },
  })
  return foreign.length
}
