import { model } from "@medusajs/framework/utils"

/**
 * Money taken out of the doit.id balance (payouts to the merchant's bank),
 * entered by hand or imported from the portal's settlement CSV.
 */
const DoitWithdrawal = model
  .define("doit_withdrawal", {
    id: model.id({ prefix: "doitwd" }).primaryKey(),
    // merchant-local calendar date, YYYY-MM-DD
    date: model.text(),
    // amount that left the doit.id balance
    amount: model.number(),
    // payout fee (doit.id: Rp10.000 per transfer) when it is charged on top
    fee_amount: model.number().default(0),
    note: model.text().nullable(),
    source: model.enum(["manual", "csv"]).default("manual"),
    // id / reference from the settlement CSV; unique so a re-import is skipped
    external_ref: model.text().unique().nullable(),
    // "live" or "test", from the API key in use when it was recorded
    environment: model.text(),
    created_by: model.text().nullable(),
    raw: model.json().nullable(),
  })
  .indexes([{ on: ["date"] }, { on: ["environment"] }])

export default DoitWithdrawal
