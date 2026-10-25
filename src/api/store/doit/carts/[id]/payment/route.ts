import type { MedusaResponse, MedusaStoreRequest } from "@medusajs/framework/http"
import { MedusaError } from "@medusajs/framework/utils"
import {
  isOpenStatus,
  mergeFresh,
  pickDoitSession,
  POLL_AFTER_MS,
  readDoitPayment,
  toPublicPayment,
} from "../../../../../../lib/store-payment"
import { loadAccessibleCart } from "../../../helpers"

/**
 * Payment status for the storefront's "waiting for payment" screen. Read-only:
 * when the stored status is still open it re-reads doit.id (throttled, see
 * StatusRefresher), so a shopper sees `paid` even before the webhook arrives,
 * and then completes the cart as usual.
 *
 * next_action: wait (keep polling) · complete_cart (paid, call cart complete) ·
 * view_order (order exists) · retry (expired / failed: pick a method again).
 * qr_expired: the QR image (≈10 min) ran out before the invoice; show hosted_url.
 */
export async function GET(req: MedusaStoreRequest, res: MedusaResponse) {
  const { cart, orderId } = await loadAccessibleCart(req, req.params.id)
  const session = pickDoitSession(cart)
  if (!session) {
    throw new MedusaError(MedusaError.Types.NOT_FOUND, "Belum ada pembayaran doit.id untuk cart ini.")
  }

  const stored = session.data ?? {}
  let data: Record<string, unknown> = stored
  let qrExpired = false
  let checkedAt: number | null = null
  if (!orderId && isOpenStatus(stored.status) && typeof stored.id === "string" && stored.id.startsWith("pay_")) {
    const fresh = await readDoitPayment(req.scope, session.provider_id, stored.id)
    if (fresh) {
      ;({ data, qrExpired } = mergeFresh(stored, fresh.payment))
      checkedAt = fresh.checkedAt
    }
  }

  const payment = toPublicPayment(data)
  const status = payment.status
  const nextAction = orderId
    ? "view_order"
    : status === "paid"
      ? "complete_cart"
      : status === "pending"
        ? "wait"
        : "retry"

  res.set("Cache-Control", "no-store")
  res.json({
    cart_id: cart.id,
    payment_session_id: session.id,
    provider_id: session.provider_id,
    order_id: orderId,
    next_action: nextAction,
    poll_after_ms: nextAction === "wait" ? POLL_AFTER_MS : null,
    checked_at: checkedAt ? new Date(checkedAt).toISOString() : null,
    // QRIS image released while the invoice is still open: continue on hosted_url
    qr_expired: qrExpired,
    payment,
  })
}
