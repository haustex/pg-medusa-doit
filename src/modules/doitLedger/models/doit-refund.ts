import { model } from "@medusajs/framework/utils"

/**
 * Refunds as doit.id reports them: from the POST /refunds response (via the
 * Medusa payment data) and from refund.succeeded / refund.failed webhooks.
 */
const DoitRefund = model
  .define("doit_refund", {
    id: model.id({ prefix: "doitref" }).primaryKey(),
    // rf_…; null only when a webhook did not carry one
    doit_refund_id: model.text().unique().nullable(),
    doit_payment_id: model.text(),
    // Medusa refund id (the Idempotency-Key we sent); null for refunds made in the portal
    medusa_refund_id: model.text().unique().nullable(),
    amount: model.number(),
    status: model.enum(["pending", "succeeded", "failed"]).default("pending"),
    reason: model.text().nullable(),
    source: model.enum(["api", "webhook", "sync"]),
    webhook_event_id: model.text().nullable(),
    raw: model.json().nullable(),
  })
  .indexes([{ on: ["doit_payment_id"] }, { on: ["status", "created_at"] }])

export default DoitRefund
