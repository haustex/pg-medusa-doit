import { PaymentSessionStatus } from "@medusajs/framework/utils"
import type { DoitPaymentStatus } from "./types"

/**
 * doit.id has exactly five statuses: pending → paid → refunded,
 * pending → expired → paid (late payment), pending → failed.
 *
 * - paid: doit.id settles immediately, there is no separate capture → captured
 * - refunded: the money was captured first; the refund itself lives in Medusa → captured
 * - expired: no longer payable through this invoice, but it can still turn into
 *   paid (bayar_telat), so it is not reported as an error → canceled
 * - failed → error
 */
export function toSessionStatus(status: DoitPaymentStatus | string | undefined): PaymentSessionStatus {
  switch (status) {
    case "pending":
      return PaymentSessionStatus.PENDING
    case "paid":
    case "refunded":
      return PaymentSessionStatus.CAPTURED
    case "expired":
      return PaymentSessionStatus.CANCELED
    case "failed":
      return PaymentSessionStatus.ERROR
    default:
      return PaymentSessionStatus.ERROR
  }
}

export function isPaidStatus(status: string | undefined): boolean {
  return status === "paid" || status === "refunded"
}
