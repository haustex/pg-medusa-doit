import { MedusaError } from "@medusajs/framework/utils"
import { createStep, StepResponse } from "@medusajs/framework/workflows-sdk"
import { encryptSecret, loadEncryptionKey } from "../../lib/crypto"
import {
  apiKeyHint,
  DoitRail,
  environmentFromKey,
  invalidateDoitCredentialsCache,
} from "../../lib/credentials"
import { DOIT_SETTINGS_MODULE } from "../../modules/doitSettings"
import DoitSettingsModuleService from "../../modules/doitSettings/service"

export type UpsertDoitSettingsInput = {
  /** undefined keeps the stored value, null removes it */
  api_key?: string | null
  webhook_secret?: string | null
  rail?: DoitRail
  va_bank?: string | null
  expires_in?: number
  timezone?: string
}

type StoredSetting = Awaited<
  ReturnType<DoitSettingsModuleService["listDoitSettings"]>
>[number]

const API_KEY_PATTERN = /^pb_(test|live)_\S+$/

export const upsertDoitSettingsStep = createStep(
  "upsert-doit-settings",
  async (input: UpsertDoitSettingsInput, { container }) => {
    const service: DoitSettingsModuleService = container.resolve(DOIT_SETTINGS_MODULE)
    const [current] = await service.listDoitSettings({}, { take: 1, order: { updated_at: "DESC" } })

    if (input.api_key && !API_KEY_PATTERN.test(input.api_key)) {
      throw new MedusaError(
        MedusaError.Types.INVALID_DATA,
        "API key doit.id harus diawali pb_test_ atau pb_live_."
      )
    }

    const data: Record<string, unknown> = {}
    if (input.rail !== undefined) data.rail = input.rail
    if (input.va_bank !== undefined) data.va_bank = input.va_bank
    if (input.expires_in !== undefined) data.expires_in = input.expires_in
    if (input.timezone !== undefined) data.timezone = input.timezone

    const writesSecret = !!input.api_key || !!input.webhook_secret
    if (writesSecret) {
      const key = loadEncryptionKey()
      if (key.status !== "ok") {
        throw new MedusaError(
          MedusaError.Types.INVALID_DATA,
          "DOIT_ENCRYPTION_KEY tidak ada atau bukan 64 karakter hex (openssl rand -hex 32). Kredensial tidak disimpan."
        )
      }

      // Secrets left untouched would stay encrypted with the old key and
      // become unreadable, so a key change requires re-entering both.
      const keyChanged =
        !!current?.encryption_key_fingerprint &&
        current.encryption_key_fingerprint !== key.fingerprint
      const keepsOldApiKey = input.api_key === undefined && !!current?.api_key_encrypted
      const keepsOldSecret =
        input.webhook_secret === undefined && !!current?.webhook_secret_encrypted
      if (keyChanged && (keepsOldApiKey || keepsOldSecret)) {
        throw new MedusaError(
          MedusaError.Types.INVALID_DATA,
          "Kunci enkripsi berubah. Masukkan ulang API key dan webhook secret sekaligus."
        )
      }

      data.encryption_key_fingerprint = key.fingerprint
      if (input.api_key) {
        data.api_key_encrypted = encryptSecret(input.api_key, key.key, "api_key")
        data.api_key_hint = apiKeyHint(input.api_key)
        data.environment = environmentFromKey(input.api_key)
      }
      if (input.webhook_secret) {
        data.webhook_secret_encrypted = encryptSecret(
          input.webhook_secret,
          key.key,
          "webhook_secret"
        )
      }
    }
    if (input.api_key === null) {
      data.api_key_encrypted = null
      data.api_key_hint = null
      data.environment = null
    }
    if (input.webhook_secret === null) {
      data.webhook_secret_encrypted = null
    }

    const saved = current
      ? await service.updateDoitSettings({ id: current.id, ...data })
      : await service.createDoitSettings(data)

    invalidateDoitCredentialsCache()
    return new StepResponse({ id: saved.id }, { previous: current ?? null, id: saved.id })
  },
  async (compensation, { container }) => {
    if (!compensation) {
      return
    }
    const service: DoitSettingsModuleService = container.resolve(DOIT_SETTINGS_MODULE)
    const { previous, id } = compensation as { previous: StoredSetting | null; id: string }
    if (previous) {
      const { created_at, updated_at, deleted_at, ...restore } = previous
      await service.updateDoitSettings(restore)
    } else {
      await service.deleteDoitSettings(id)
    }
    invalidateDoitCredentialsCache()
  }
)
