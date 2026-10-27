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
  // IANA zone for day boundaries in the Admin dashboard
  timezone: model.text().default("Asia/Jakarta"),
  // put in front of the payment session id in doit.id's `reference`, e.g. "HK-"
  reference_prefix: model.text().nullable(),
  // reconciliation ignores doit.id payments created before this instant
  ignore_before: model.dateTime().nullable(),
  // when an API key was first saved here; the default for ignore_before
  credentials_saved_at: model.dateTime().nullable(),
})

export default DoitSetting
