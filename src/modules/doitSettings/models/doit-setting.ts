import { model } from "@medusajs/framework/utils"

/**
 * Single-row table holding the merchant's doit.id configuration.
 *
 * The payment provider reads this table directly through the shared
 * `__pg_connection__` (see src/lib/credentials.ts), so column renames here
 * must be mirrored there.
 */
const DoitSetting = model.define("doit_setting", {
  id: model.id({ prefix: "doitset" }).primaryKey(),
  api_key_encrypted: model.text().nullable(),
  // e.g. "pb_test_…a1b2"; safe to show in the Admin
  api_key_hint: model.text().nullable(),
  webhook_secret_encrypted: model.text().nullable(),
  encryption_key_fingerprint: model.text().nullable(),
  environment: model.enum(["sandbox", "production"]).nullable(),
  rail: model.enum(["any", "qris", "va", "transfer"]).default("any"),
  va_bank: model.text().nullable(),
  expires_in: model.number().default(86400),
})

export default DoitSetting
