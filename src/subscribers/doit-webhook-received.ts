import type { SubscriberArgs, SubscriberConfig } from "@medusajs/framework"
import { PaymentWebhookEvents } from "@medusajs/framework/utils"
import { handleDoitWebhook, type WebhookEventData } from "../lib/doit-processing"

/**
 * Processes doit.id webhooks queued by Medusa's /hooks/payment route. The
 * provider's getWebhookActionAndData answers not_supported, so Medusa's own
 * handler leaves doit events alone and this subscriber owns them.
 */
export default async function doitWebhookReceivedHandler({ event, container }: SubscriberArgs<WebhookEventData>) {
  await handleDoitWebhook(container, event.data)
}

export const config: SubscriberConfig = {
  event: PaymentWebhookEvents.WebhookReceived,
  context: { subscriberId: "doit-webhook-received" },
}
