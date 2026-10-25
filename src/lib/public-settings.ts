import type { DoitCredentials } from "./credentials"
import { maskSecret } from "./mask"

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
  encryption: DoitCredentials["encryption"]
  webhook_path: string
}

/**
 * The only shape in which settings leave the server. Built field by field
 * (never by spreading `creds`) so a new secret field can't leak by accident.
 */
export function toPublicSettings(creds: DoitCredentials): PublicDoitSettings {
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
    encryption: {
      status: creds.encryption.status,
      message: creds.encryption.message,
    },
    webhook_path: WEBHOOK_PATH,
  }
}
