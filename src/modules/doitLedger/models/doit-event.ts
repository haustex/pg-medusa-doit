import { model } from "@medusajs/framework/utils"

/**
 * Webhook deliveries by event id (`evt_…`). The unique event_id is the dedupe:
 * the server claims the row before queuing, the worker records the outcome.
 */
const DoitEvent = model
  .define("doit_event", {
    id: model.id({ prefix: "doitevt" }).primaryKey(),
    event_id: model.text().unique(),
    type: model.text(),
    doit_payment_id: model.text().nullable(),
    // received → processed | ignored | failed (gave up after the configured attempts)
    status: model.enum(["received", "processed", "ignored", "failed"]).default("received"),
    attempts: model.number().default(0),
    last_error: model.text().nullable(),
    received_at: model.dateTime(),
    processed_at: model.dateTime().nullable(),
    payload: model.json().nullable(),
  })
  .indexes([{ on: ["status"] }, { on: ["doit_payment_id"] }])

export default DoitEvent
