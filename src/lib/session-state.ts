import type { MedusaContainer } from "@medusajs/framework/types"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import type { SessionState } from "../providers/doit/webhook"
import { sessionIdFromReference } from "./ownership"

type Logger = { warn: (msg: string) => void }

/** Medusa view of a payment session, plus the cart / order it led to. */
export type SessionContext = {
  state: SessionState
  cartId: string | null
  orderId: string | null
  /** Medusa refund total for the session's payment */
  medusaRefunded: number | null
  medusaPaymentId: string | null
}

function num(value: unknown): number | null {
  if (value === null || value === undefined) {
    return null
  }
  const n = Number(value)
  return Number.isFinite(n) ? n : null
}

/**
 * Reads the session through Query (soft-deleted sessions come back as
 * missing). Never throws: `null` means the state is unknown.
 */
export async function loadSessionContext(
  container: MedusaContainer,
  sessionId: string,
  logger?: Logger
): Promise<SessionContext | null> {
  const query = container.resolve(ContainerRegistrationKeys.QUERY)
  try {
    const { data: sessions } = await query.graph({
      entity: "payment_session",
      fields: [
        "id",
        "status",
        "amount",
        "data",
        "payment_collection_id",
        "payment.id",
        "payment.captured_at",
        "payment.canceled_at",
        "payment.refunds.amount",
      ],
      filters: { id: sessionId },
    })
    const session = sessions[0] as Record<string, any> | undefined

    let cartId: string | null = null
    let orderId: string | null = null
    if (session?.payment_collection_id) {
      const { data: carts } = await query.graph({
        entity: "cart_payment_collection",
        fields: ["cart_id"],
        filters: { payment_collection_id: session.payment_collection_id },
      })
      cartId = (carts[0] as { cart_id?: string } | undefined)?.cart_id ?? null
      if (cartId) {
        const { data: orders } = await query.graph({
          entity: "order_cart",
          fields: ["order_id"],
          filters: { cart_id: cartId },
        })
        orderId = (orders[0] as { order_id?: string } | undefined)?.order_id ?? null
      }
    }

    const payment = session?.payment as Record<string, any> | null | undefined
    const refunds = (payment?.refunds ?? []) as { amount: unknown }[]
    return {
      state: {
        session: session
          ? {
              id: session.id,
              status: session.status,
              amount: num(session.amount),
              deleted: false,
              doitPaymentId: typeof session.data?.id === "string" ? session.data.id : null,
            }
          : null,
        payment: payment
          ? { id: payment.id, captured: !!payment.captured_at, canceled: !!payment.canceled_at }
          : null,
      },
      cartId,
      orderId,
      medusaRefunded: payment ? refunds.reduce((sum, r) => sum + (num(r.amount) ?? 0), 0) : null,
      medusaPaymentId: payment?.id ?? null,
    }
  } catch (e) {
    logger?.warn(`[doit] Could not read payment session ${sessionId}: ${(e as Error).message}`)
    return null
  }
}

/**
 * The Medusa session a doit.id payment belongs to. Normally its `reference`.
 * An invoice reused by a later session of the same collection still carries
 * the first session's id (Medusa hard-deletes replaced sessions), so when that
 * session is gone the collection from the invoice metadata is searched for the
 * session that now holds this payment id.
 */
export async function resolveSessionId(
  container: MedusaContainer,
  payment: { id: string; reference?: unknown; metadata?: Record<string, unknown> | null },
  logger?: Logger
): Promise<string | null> {
  const byReference = sessionIdFromReference(payment.reference)
  const collectionId = payment.metadata?.medusa_payment_collection_id
  if (typeof collectionId !== "string" || !collectionId) {
    return byReference
  }
  const query = container.resolve(ContainerRegistrationKeys.QUERY)
  try {
    if (byReference) {
      const { data } = await query.graph({ entity: "payment_session", fields: ["id", "data"], filters: { id: byReference } })
      const own = data[0] as { data?: Record<string, unknown> } | undefined
      if (own && own.data?.id === payment.id) {
        return byReference
      }
    }
    const { data: sessions } = await query.graph({
      entity: "payment_session",
      fields: ["id", "data"],
      filters: { payment_collection_id: collectionId },
    })
    const holder = (sessions as { id: string; data?: Record<string, unknown> }[]).find((s) => s.data?.id === payment.id)
    return holder?.id ?? byReference
  } catch (e) {
    logger?.warn(`[doit] Could not resolve the session of ${payment.id}: ${(e as Error).message}`)
    return byReference
  }
}
