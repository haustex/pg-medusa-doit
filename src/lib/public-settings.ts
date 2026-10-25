import type { DoitCredentials } from "./credentials"
import { maskSecret } from "./mask"
import type { DoitPluginOptions } from "./plugin-options"

export const WEBHOOK_PATH = "/hooks/payment/doit_doit"

export type PublicSecret = {
  is_set: boolean
  masked: string | null
}

export type PublicDoitSettings = {
  configured: boolean
  credential_source: DoitCredentials["source"]
  environment: DoitCredentials["environment"]
  api_key: PublicSecret
  webhook_secret: PublicSecret
  rail: DoitCredentials["rail"]
  va_bank: string | null
  expires_in: number
  timezone: string
  encryption: DoitCredentials["encryption"]
  webhook_path: string
  /** absolute URL to paste in the doit.id portal, when the backend URL is known */
  webhook_url: string | null
  show_credit: boolean
}

/**
 * The only shape in which settings leave the server. Built field by field
 * (never by spreading `creds`) so a new secret field can't leak by accident.
 */
export function toPublicSettings(
  creds: DoitCredentials,
  pluginOptions: Required<DoitPluginOptions> = { showCredit: true },
  backendUrl: string | null = null
): PublicDoitSettings {
  return {
    configured: !!creds.apiKey,
    credential_source: creds.source,
    environment: creds.environment,
    api_key: {
      is_set: !!creds.apiKey,
      masked: maskSecret(creds.apiKey),
    },
    webhook_secret: {
      is_set: !!creds.webhookSecret,
      masked: maskSecret(creds.webhookSecret),
    },
    rail: creds.rail,
    va_bank: creds.vaBank,
    expires_in: creds.expiresIn,
    timezone: creds.timezone,
    encryption: {
      status: creds.encryption.status,
      message: creds.encryption.message,
    },
    webhook_path: WEBHOOK_PATH,
    webhook_url: backendUrl ? `${backendUrl.replace(/\/+$/, "")}${WEBHOOK_PATH}` : null,
    show_credit: pluginOptions.showCredit,
  }
}
