"use client"

import { HttpTypes } from "@medusajs/types"
import { Button } from "@medusajs/ui"
import { doitLabels } from "./labels"
import DoitPaymentPanel from "./payment-panel"

export { default as DoitRailPicker } from "./rail-picker"
export { default as DoitPaymentPanel } from "./payment-panel"
export { doitLabels }

/** True for any doit.id provider registered in Medusa (pp_doit_<id>). */
export const isDoit = (providerId?: string) => !!providerId?.startsWith("pp_doit_")

/**
 * Drop-in for the review step's PaymentButton: once address, email and
 * shipping are set, shows the payment panel instead of a "Place order" button.
 * The order is placed automatically when doit.id reports the payment as paid.
 */
export function DoitPaymentButton({
  cart,
  notReady,
  redirectToHosted = process.env.NEXT_PUBLIC_DOIT_REDIRECT_TO_HOSTED === "true",
}: {
  cart: HttpTypes.StoreCart
  notReady: boolean
  redirectToHosted?: boolean
}) {
  const session = cart.payment_collection?.payment_sessions?.find(
    (s) => isDoit(s.provider_id) && s.status === "pending"
  )
  if (notReady || !session) {
    return (
      <Button disabled size="large">
        {doitLabels.payButton}
      </Button>
    )
  }
  return <DoitPaymentPanel cart={cart} providerId={session.provider_id} redirectToHosted={redirectToHosted} />
}
