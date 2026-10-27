import type { MedusaContainer } from "@medusajs/framework/types"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import type { DoitCredentials } from "./credentials"
import { classifyPayment, type IgnoreReason, type OwnershipContext, storeIdOf } from "./ownership"
import { resolveSessionId } from "./session-state"

type Payment = {
  id: string
  reference?: unknown
  environment?: unknown
  created_at?: unknown
  metadata?: Record<string, unknown> | null
}

export async function ownershipContext(container: MedusaContainer, creds: DoitCredentials): Promise<OwnershipContext> {
  return {
    storeId: await storeIdOf(container.resolve(ContainerRegistrationKeys.PG_CONNECTION)),
    keyEnvironment: creds.environment,
    ignoreBefore: creds.ignoreBefore,
  }
}

export type Partition<T> = { ours: T[]; ignored: { payment: T; reason: IgnoreReason | "legacy_unknown" }[] }

/**
 * Splits doit.id payments into the ones this store reconciles and the ones it
 * ignores (see src/lib/ownership.ts). A payment from before the store marker
 * (plugin 0.1.0/0.1.1) counts as ours only while its Medusa session exists.
 */
export async function partitionOurs<T extends Payment>(
  container: MedusaContainer,
  payments: T[],
  ctx: OwnershipContext
): Promise<Partition<T>> {
  const out: Partition<T> = { ours: [], ignored: [] }
  const legacy: { payment: T; sessionId: string }[] = []
  for (const payment of payments) {
    const owner = classifyPayment(payment, ctx)
    if (owner.ours === true) out.ours.push(payment)
    else if (owner.ours === "legacy") legacy.push({ payment, sessionId: owner.sessionId })
    else out.ignored.push({ payment, reason: owner.reason })
  }
  if (!legacy.length) {
    return out
  }

  const query = container.resolve(ContainerRegistrationKeys.QUERY)
  const { data } = await query.graph({
    entity: "payment_session",
    fields: ["id"],
    filters: { id: [...new Set(legacy.map((l) => l.sessionId))] },
  })
  const existing = new Set((data as { id: string }[]).map((s) => s.id))
  for (const { payment, sessionId } of legacy) {
    if (existing.has(sessionId)) {
      out.ours.push(payment)
      continue
    }
    // 0.1.1 reused invoices: the session that holds it now, found through the collection
    const holder = payment.metadata?.medusa_payment_collection_id
      ? await resolveSessionId(container, payment)
      : null
    if (holder && holder !== sessionId) out.ours.push(payment)
    else out.ignored.push({ payment, reason: "legacy_unknown" })
  }
  return out
}

/** One payment: ours or not. */
export async function isOurs(container: MedusaContainer, payment: Payment, ctx: OwnershipContext): Promise<boolean> {
  return (await partitionOurs(container, [payment], ctx)).ours.length === 1
}
