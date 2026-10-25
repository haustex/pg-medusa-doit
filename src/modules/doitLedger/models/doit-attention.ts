import { model } from "@medusajs/framework/utils"

export const ATTENTION_CODES = [
  // bayar_ganda: same invoice paid through two instruments; refund the excess
  "overpaid",
  // paid after expiry while the Medusa payment was already canceled: fulfil or refund
  "late_payment_canceled",
  // paid after expiry with late_payment_policy "flag": accept or refund
  "late_payment_flagged",
  // paid, but the Medusa payment session no longer exists
  "paid_without_session",
  // paid an invoice the session no longer points to (amount changed in between)
  "superseded_invoice_paid",
  // doit.id amount differs from the session amount
  "amount_mismatch",
  // doit.id refund total differs from Medusa's, or exceeds the payment
  "refund_mismatch",
  // refund.failed from doit.id
  "refund_failed",
  // webhook processing gave up after the configured attempts
  "webhook_failed",
] as const

export type AttentionCode = (typeof ATTENTION_CODES)[number]

/**
 * "Perlu tindakan": cases a person has to decide (fulfil, refund, check).
 * dedupe_key keeps one open item per case however often it is detected.
 */
const DoitAttention = model
  .define("doit_attention", {
    id: model.id({ prefix: "doitatt" }).primaryKey(),
    code: model.enum([...ATTENTION_CODES]),
    dedupe_key: model.text().unique(),
    status: model.enum(["open", "resolved", "dismissed"]).default("open"),
    doit_payment_id: model.text().nullable(),
    session_id: model.text().nullable(),
    order_id: model.text().nullable(),
    event_id: model.text().nullable(),
    // rupiah involved (excess, refund difference, …) when known
    amount: model.number().nullable(),
    message: model.text(),
    details: model.json().nullable(),
    resolved_at: model.dateTime().nullable(),
    resolved_by: model.text().nullable(),
    resolution_note: model.text().nullable(),
  })
  .indexes([{ on: ["status"] }, { on: ["code"] }, { on: ["doit_payment_id"] }])

export default DoitAttention
