import type { SubscriberArgs, SubscriberConfig } from "@medusajs/framework"
import { ContainerRegistrationKeys, PaymentEvents } from "@medusajs/framework/utils"
import { handleMedusaRefund } from "../lib/doit-processing"

/** Records the doit.id refund responses of a Medusa refund in the ledger. */
export default async function doitPaymentRefundedHandler({ event, container }: SubscriberArgs<{ id: string }>) {
  try {
    await handleMedusaRefund(container, event.data.id)
  } catch (e) {
    container
      .resolve(ContainerRegistrationKeys.LOGGER)
      .error(`[doit] Could not record refunds of ${event.data.id}: ${(e as Error).message}`)
    throw e
  }
}

export const config: SubscriberConfig = {
  event: PaymentEvents.REFUNDED,
  context: { subscriberId: "doit-payment-refunded" },
}
