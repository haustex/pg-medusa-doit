import type { Knex } from "@medusajs/framework/mikro-orm/knex"
import { decryptSecret, loadEncryptionKey } from "./crypto"
import { maskSecret } from "./mask"

/**
 * Resolves doit.id credentials for the current process.
 *
 * Source of truth is the `doit_setting` table (written by the Admin, encrypted).
 * It is read straight from the database so the server and the worker process
 * (workerMode "server" / "worker") always agree; an in-memory cache with a short
 * TTL only saves round trips. Saving settings clears the cache in the saving
 * process directly and in other processes through the `doit.settings.updated`
 * event, so the TTL is the upper bound on staleness.
 *
 * Priority: Admin (database) → provider options → environment variables.
 * Nothing in here throws: a broken key or a missing table degrades to the next
 * source and is reported through `encryption`.
 */

export const DOIT_SETTINGS_TABLE = "doit_setting"
export const DOIT_SETTINGS_UPDATED_EVENT = "doit.settings.updated"
export const DEFAULT_CACHE_TTL_MS = 60_000

export type DoitRail = "any" | "qris" | "va" | "transfer"
export type DoitEnvironment = "sandbox" | "production"
export type CredentialSource = "admin" | "options" | "env" | "none"

export type EncryptionStatus =
  // stored secrets decrypted fine
  | "ok"
  // no secrets stored in the Admin, so the key is not needed
  | "unused"
  // secrets are stored but DOIT_ENCRYPTION_KEY is unset / not 64 hex chars
  | "missing"
  | "malformed"
  // DOIT_ENCRYPTION_KEY differs from the one used to encrypt, or ciphertext is corrupt
  | "mismatch"

export const ENCRYPTION_KEY_INVALID_MESSAGE =
  "Kunci enkripsi tidak valid, masukkan ulang kredensial."

export type LatePaymentPolicy = "accept" | "flag"

export type DoitProviderOptions = {
  api_key?: string
  webhook_secret?: string
  rail?: DoitRail
  va_bank?: string
  expires_in?: number
  credentials_cache_ttl_ms?: number
  /** Override for tests; defaults to https://pay.doit.id */
  api_base_url?: string
  /** Per-request timeout. Default 15000. */
  request_timeout_ms?: number
  /** Retries for 429 / 5xx / network errors, with the same Idempotency-Key. Default 2. */
  max_retries?: number
  /** Longest Retry-After we are willing to wait inside one call. Default 15000. */
  max_retry_wait_ms?: number
  /**
   * What to do with a payment paid after it expired (`bayar_telat`) whose
   * session is still open: "accept" captures it (default), "flag" leaves the
   * Medusa payment untouched and only logs that it needs a decision.
   */
  late_payment_policy?: LatePaymentPolicy
}

export type DoitCredentials = {
  source: CredentialSource
  apiKey: string | null
  webhookSecret: string | null
  environment: DoitEnvironment | null
  apiKeyHint: string | null
  rail: DoitRail
  vaBank: string | null
  expiresIn: number
  /** IANA zone for the Admin dashboard's day boundaries */
  timezone: string
  /** put in front of the session id in doit.id's `reference` ("" = none) */
  referencePrefix: string
  /**
   * Reconciliation ignores doit.id payments created before this: the Admin's
   * "ignore before" date, else when an API key was first saved here.
   */
  ignoreBefore: Date | null
  ignoreBeforeSource: "setting" | "credentials_saved" | null
  credentialsSavedAt: Date | null
  encryption: {
    status: EncryptionStatus
    message: string | null
  }
  /** true when the Admin row exists but could not be used */
  adminUnavailable: boolean
}

type StoredSettingRow = {
  api_key_encrypted: string | null
  api_key_hint: string | null
  webhook_secret_encrypted: string | null
  encryption_key_fingerprint: string | null
  rail: DoitRail | null
  va_bank: string | null
  expires_in: number | null
  timezone?: string | null
  reference_prefix?: string | null
  ignore_before?: Date | string | null
  credentials_saved_at?: Date | string | null
}

type AdminLookup = {
  row: StoredSettingRow | null
  apiKey: string | null
  webhookSecret: string | null
  status: EncryptionStatus
}

type CacheEntry = { value: AdminLookup; expiresAt: number }

// Kept on globalThis so every copy of this file loaded in the process
// (provider, API routes, subscriber) shares one cache.
const CACHE_KEY = Symbol.for("medusa-payment-doit.credentials-cache")
type CacheHolder = { [CACHE_KEY]?: CacheEntry | null }
const holder = globalThis as CacheHolder

export function invalidateDoitCredentialsCache(): void {
  holder[CACHE_KEY] = null
}

export function environmentFromKey(apiKey: string | null): DoitEnvironment | null {
  if (!apiKey) {
    return null
  }
  if (apiKey.startsWith("pb_live_")) {
    return "production"
  }
  if (apiKey.startsWith("pb_test_")) {
    return "sandbox"
  }
  return null
}

export function apiKeyHint(apiKey: string): string {
  return maskSecret(apiKey) ?? ""
}

type Logger = { warn: (msg: string) => void }

export async function resolveDoitCredentials(
  pg: Knex | undefined,
  options: DoitProviderOptions = {},
  {
    logger,
    fresh = false,
  }: { logger?: Logger; fresh?: boolean } = {}
): Promise<DoitCredentials> {
  const admin = await lookupAdmin(pg, options, { logger, fresh })
  const row = admin.row
  const adminUnavailable =
    !!row &&
    (!!row.api_key_encrypted || !!row.webhook_secret_encrypted) &&
    admin.status !== "ok"

  let source: CredentialSource = "none"
  let apiKey: string | null = null
  if (admin.apiKey) {
    source = "admin"
    apiKey = admin.apiKey
  } else if (options.api_key) {
    source = "options"
    apiKey = options.api_key
  } else if (process.env.DOIT_API_KEY) {
    source = "env"
    apiKey = process.env.DOIT_API_KEY
  }

  // The secret always comes from the same source as the key so a sandbox key
  // is never paired with a production secret from somewhere else.
  const secretBySource = {
    admin: admin.webhookSecret,
    options: options.webhook_secret ?? null,
    env: process.env.DOIT_WEBHOOK_SECRET ?? null,
  }
  const webhookSecret =
    source === "none"
      ? secretBySource.admin ?? secretBySource.options ?? secretBySource.env
      : secretBySource[source]

  return {
    source,
    apiKey,
    webhookSecret,
    environment: environmentFromKey(apiKey),
    apiKeyHint: source === "admin" ? row?.api_key_hint ?? null : apiKey ? apiKeyHint(apiKey) : null,
    rail: row?.rail ?? options.rail ?? "any",
    vaBank: row?.va_bank ?? options.va_bank ?? null,
    expiresIn: row?.expires_in ?? options.expires_in ?? 86400,
    timezone: row?.timezone || "Asia/Jakarta",
    referencePrefix: row?.reference_prefix ?? "",
    ignoreBefore: toDateOrNull(row?.ignore_before) ?? toDateOrNull(row?.credentials_saved_at),
    ignoreBeforeSource: toDateOrNull(row?.ignore_before)
      ? "setting"
      : toDateOrNull(row?.credentials_saved_at)
        ? "credentials_saved"
        : null,
    credentialsSavedAt: toDateOrNull(row?.credentials_saved_at),
    encryption: {
      status: admin.status,
      message: adminUnavailable ? ENCRYPTION_KEY_INVALID_MESSAGE : null,
    },
    adminUnavailable,
  }
}

function toDateOrNull(value: Date | string | null | undefined): Date | null {
  if (!value) {
    return null
  }
  const d = value instanceof Date ? value : new Date(value)
  return Number.isNaN(d.getTime()) ? null : d
}

const BASE_COLUMNS = [
  "api_key_encrypted",
  "api_key_hint",
  "webhook_secret_encrypted",
  "encryption_key_fingerprint",
  "rail",
  "va_bank",
  "expires_in",
  "timezone",
] as const
// Added in 0.1.2. Read separately so an install that has not run the migration
// yet keeps its credentials.
const RECONCILE_COLUMNS = ["reference_prefix", "ignore_before", "credentials_saved_at"] as const

async function lookupAdmin(
  pg: Knex | undefined,
  options: DoitProviderOptions,
  { logger, fresh }: { logger?: Logger; fresh: boolean }
): Promise<AdminLookup> {
  const cached = holder[CACHE_KEY]
  if (!fresh && cached && cached.expiresAt > Date.now()) {
    return cached.value
  }

  const value = await readAdminSettings(pg, logger)
  const ttl = options.credentials_cache_ttl_ms ?? DEFAULT_CACHE_TTL_MS
  holder[CACHE_KEY] = { value, expiresAt: Date.now() + ttl }
  return value
}

async function readAdminSettings(
  pg: Knex | undefined,
  logger?: Logger
): Promise<AdminLookup> {
  const empty: AdminLookup = {
    row: null,
    apiKey: null,
    webhookSecret: null,
    status: "unused",
  }
  if (!pg) {
    return empty
  }

  let row: StoredSettingRow | undefined
  const read = (columns: readonly string[]) =>
    pg<StoredSettingRow>(DOIT_SETTINGS_TABLE)
      .select(...columns)
      .whereNull("deleted_at")
      .orderBy("updated_at", "desc")
      .first()
  try {
    try {
      row = await read([...BASE_COLUMNS, ...RECONCILE_COLUMNS])
    } catch {
      row = await read(BASE_COLUMNS)
      logger?.warn("[doit] doit_setting has no reconciliation columns yet; run `npx medusa db:migrate`.")
    }
  } catch (e) {
    // Most likely migrations have not been run yet.
    logger?.warn(
      `[doit] Could not read ${DOIT_SETTINGS_TABLE} (${(e as Error).message}); falling back to provider options / env.`
    )
    return empty
  }

  if (!row) {
    return empty
  }
  if (!row.api_key_encrypted && !row.webhook_secret_encrypted) {
    return { ...empty, row }
  }

  const key = loadEncryptionKey()
  if (key.status !== "ok") {
    return { ...empty, row, status: key.status }
  }
  if (
    row.encryption_key_fingerprint &&
    row.encryption_key_fingerprint !== key.fingerprint
  ) {
    return { ...empty, row, status: "mismatch" }
  }

  try {
    return {
      row,
      apiKey: row.api_key_encrypted
        ? decryptSecret(row.api_key_encrypted, key.key, "api_key")
        : null,
      webhookSecret: row.webhook_secret_encrypted
        ? decryptSecret(row.webhook_secret_encrypted, key.key, "webhook_secret")
        : null,
      status: "ok",
    }
  } catch {
    return { ...empty, row, status: "mismatch" }
  }
}
