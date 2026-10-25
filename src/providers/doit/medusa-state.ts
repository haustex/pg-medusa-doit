import type { Knex } from "@medusajs/framework/mikro-orm/knex"

/**
 * Read-only view of the Medusa payment session a doit.id payment belongs to,
 * used by the webhook handler to tell a normal payment apart from a late one
 * on a canceled order, a duplicate one, or one for a superseded invoice.
 *
 * The provider cannot resolve the Payment Module service from its container,
 * so it reads the Payment Module's own tables through the shared connection.
 * Lookups never throw: `null` means "unknown" and the caller falls back to
 * the plain behaviour (Medusa's capture is idempotent).
 */
export type SessionState = {
  session: {
    id: string
    status: string
    amount: number | null
    deleted: boolean
    /** doit.id payment id currently attached to the session */
    doitPaymentId: string | null
  } | null
  payment: {
    id: string
    captured: boolean
    canceled: boolean
  } | null
}

type Logger = { warn: (msg: string) => void }

export async function lookupSessionState(
  pg: Knex | undefined,
  sessionId: string,
  logger?: Logger
): Promise<SessionState | null> {
  if (!pg) {
    return null
  }
  try {
    const session = await pg("payment_session")
      .select("id", "status", "amount", "data", "deleted_at")
      .where({ id: sessionId })
      .first()
    const payment = await pg("payment")
      .select("id", "captured_at", "canceled_at")
      .where({ payment_session_id: sessionId })
      .whereNull("deleted_at")
      .first()

    const data = parseData(session?.data)
    return {
      session: session
        ? {
            id: session.id,
            status: session.status,
            amount: session.amount === null || session.amount === undefined ? null : Number(session.amount),
            deleted: !!session.deleted_at,
            doitPaymentId: typeof data.id === "string" ? data.id : null,
          }
        : null,
      payment: payment
        ? {
            id: payment.id,
            captured: !!payment.captured_at,
            canceled: !!payment.canceled_at,
          }
        : null,
    }
  } catch (e) {
    logger?.warn(`[doit] Could not read payment session ${sessionId}: ${(e as Error).message}`)
    return null
  }
}

function parseData(value: unknown): Record<string, unknown> {
  if (typeof value === "string") {
    try {
      return JSON.parse(value) ?? {}
    } catch {
      return {}
    }
  }
  return value && typeof value === "object" ? (value as Record<string, unknown>) : {}
}
