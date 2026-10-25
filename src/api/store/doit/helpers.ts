import type { MedusaStoreRequest } from "@medusajs/framework/http"
import { ContainerRegistrationKeys, MedusaError } from "@medusajs/framework/utils"
import { canAccessCart, type StoreCart } from "../../../lib/store-payment"

const CART_ID = /^cart_[0-9A-Za-z]{10,40}$/

/**
 * Loads a cart the requester may read, plus the order it became. Anything the
 * requester may not see answers 404, the same as a cart that does not exist.
 */
export async function loadAccessibleCart(
  req: MedusaStoreRequest<unknown>,
  cartId: string
): Promise<{ cart: StoreCart; orderId: string | null }> {
  const notFound = new MedusaError(MedusaError.Types.NOT_FOUND, "Cart tidak ditemukan.")
  if (!CART_ID.test(cartId)) {
    throw notFound
  }
  const query = req.scope.resolve(ContainerRegistrationKeys.QUERY)
  const { data } = await query.graph({
    entity: "cart",
    fields: [
      "id",
      "sales_channel_id",
      "customer_id",
      "customer.has_account",
      "completed_at",
      "currency_code",
      "total",
      "payment_collection.payment_sessions.id",
      "payment_collection.payment_sessions.provider_id",
      "payment_collection.payment_sessions.status",
      "payment_collection.payment_sessions.data",
      "payment_collection.payment_sessions.created_at",
    ],
    filters: { id: cartId },
  })
  const cart = data[0] as StoreCart | undefined
  const auth = (req as { auth_context?: { actor_id?: string; actor_type?: string } }).auth_context
  const allowed =
    !!cart &&
    canAccessCart(cart, {
      salesChannelIds: req.publishable_key_context?.sales_channel_ids ?? [],
      customerId: auth?.actor_type === "customer" ? auth.actor_id : null,
    })
  if (!allowed) {
    throw notFound
  }

  const { data: links } = await query.graph({
    entity: "order_cart",
    fields: ["order_id"],
    filters: { cart_id: cartId },
  })
  return { cart: cart!, orderId: (links[0] as { order_id?: string } | undefined)?.order_id ?? null }
}
