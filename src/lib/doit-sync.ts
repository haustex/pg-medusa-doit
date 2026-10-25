import crypto from "node:crypto"
import type { MedusaContainer } from "@medusajs/framework/types"
import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils"
import { DOIT_LEDGER_MODULE } from "../modules/doitLedger"
import type DoitLedgerModuleService from "../modules/doitLedger/service"
import { DoitClient } from "../providers/doit/client"
import type { DoitPayment } from "../providers/doit/types"
import { recordDoitLedgerWorkflow } from "../workflows/record-doit-ledger"
import { saveDoitSyncStateWorkflow } from "../workflows/save-doit-sync-state"
import { resolveDoitCredentials, type DoitProviderOptions } from "./credentials"
import { settlePaidPayment } from "./doit-processing"
import { attention, toLedgerPayment } from "./ledger"
import { DOIT_PROVIDER_IDENTIFIER } from "./provider-options"

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
}

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

  const stateKey = `payments:${providerId}`
  const service = container.resolve(DOIT_LEDGER_MODULE) as DoitLedgerModuleService
  const runStart = new Date()
  try {
    const [state] = await service.listDoitSyncStates({ key: stateKey }, { take: 1 })
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
      await recordDoitLedgerWorkflow(container).run({
        input: {
          payments: data.map((p) => toLedgerPayment(p, { last_synced_at: new Date(), authoritative: true })),
        },
      })
      const pageNewest = newestCreatedAt(data)
      if (pageNewest && (!newest || pageNewest > newest)) newest = pageNewest
      const oldest = oldestCreatedAt(data)
      if (data.length < PAGE_SIZE || !oldest || Date.parse(oldest) <= stopAt || oldest === before) break
      before = oldest
    }

    // 2. re-read open payments the scan did not refresh
    const open = await service.listDoitPayments(
      { status: ["pending", "expired"], last_synced_at: { $lt: runStart } } as never,
      { take: MAX_RECHECKS * 2, order: { doit_created_at: "DESC" } }
    )
    const recheck = open
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
    const unsettled = await service.listDoitPayments(
      { status: "paid", reconciled_at: null, session_id: { $ne: null } } as never,
      { take: MAX_RECONCILES, order: { paid_at: "DESC" } }
    )
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

    // 4. webhooks stuck with errors (no retries configured, or the worker died mid-way)
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
      `[doit] Sync ${providerId}: ${stats.scanned} scanned in ${stats.pages} page(s), ${stats.rechecked} re-read, ${stats.reconciled} settled, ${stats.attentions} perlu tindakan, ${stats.stale_events} stale webhook(s).`
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
