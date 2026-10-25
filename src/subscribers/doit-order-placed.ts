import type { SubscriberArgs, SubscriberConfig } from "@medusajs/framework"
import { ContainerRegistrationKeys, OrderWorkflowEvents } from "@medusajs/framework/utils"
import { handleOrderPlaced } from "../lib/doit-processing"

/** Notes the doit.id method and fee on the order and records the payment in the ledger. */
export default async function doitOrderPlacedHandler({ event, container }: SubscriberArgs<{ id: string }>) {
  try {
    await handleOrderPlaced(container, event.data.id)
  } catch (e) {
    container
      .resolve(ContainerRegistrationKeys.LOGGER)
      .error(`[doit] Could not annotate order ${event.data.id}: ${(e as Error).message}`)
    throw e
  }
}

export const config: SubscriberConfig = {
  event: OrderWorkflowEvents.PLACED,
  context: { subscriberId: "doit-order-placed" },
}
