import { model } from "@medusajs/framework/utils"

/**
 * One row per doit.id payment (`pay_…`), written by webhooks, the refund
 * subscriber and the sync job. Amounts are integer rupiah as doit.id sends them.
 */
const DoitPayment = model
  .define("doit_payment", {
    id: model.id({ prefix: "doitpay" }).primaryKey(),
    doit_id: model.text().unique(),
    reference: model.text(),
    // set when reference is a Medusa payment session id
    session_id: model.text().nullable(),
    order_id: model.text().nullable(),
    status: model.text(),
    // invoice amount (gross)
    amount: model.number(),
    fee_amount: model.number().default(0),
    // what the merchant receives: amount minus the fee when the merchant pays it
    net_amount: model.number(),
    total_amount: model.number().nullable(),
    fee_payer: model.text().nullable(),
    rail: model.text().nullable(),
    va_bank: model.text().nullable(),
    environment: model.text().nullable(),
    flags: model.json().nullable(),
    // sum of succeeded refunds in doit_refund (doit.id keeps status "paid" after refunds)
    refunded_amount: model.number().default(0),
    paid_at: model.dateTime().nullable(),
    expires_at: model.dateTime().nullable(),
    doit_created_at: model.dateTime().nullable(),
    // Medusa side settled: captured, or handed over to doit_attention
    reconciled_at: model.dateTime().nullable(),
    last_synced_at: model.dateTime().nullable(),
    raw: model.json().nullable(),
    // Not this store's payment (another app or store on the key, or the other mode):
    // kept for the record, left out of every dashboard figure and of reconciliation.
    excluded_at: model.dateTime().nullable(),
    excluded_reason: model.text().nullable(),
  })
  .indexes([
    { on: ["status"] },
    { on: ["reference"] },
    { on: ["doit_created_at"] },
    { on: ["paid_at"] },
    { on: ["environment", "status"] },
    { on: ["order_id"] },
    { on: ["excluded_at"] },
  ])

export default DoitPayment
