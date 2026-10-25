import crypto from "node:crypto"
import type { MedusaContainer } from "@medusajs/framework/types"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import { DoitClient } from "../providers/doit/client"
import type { DoitPayment } from "../providers/doit/types"
import { TRANSFER_BANKS, VA_BANKS } from "./banks"
import { type DoitCredentials, type DoitProviderOptions, resolveDoitCredentials } from "./credentials"
import { getDoitProviderOptions } from "./provider-options"

/** A stored status younger than this is served without asking doit.id again. */
export const STATUS_REFRESH_MS = 10_000
/** At most this many status reads per minute per process for storefront polling (half of doit.id's 120). */
export const STATUS_REFRESH_BUDGET_PER_MINUTE = 60
export const METHODS_CACHE_MS = 5 * 60_000
/** Suggested polling interval while a payment is open. */
export const POLL_AFTER_MS = 5_000

export const DEFAULT_DOIT_PROVIDER_ID = "pp_doit_doit"

// ---------------------------------------------------------------- access

export type StoreCart = {
  id: string
  sales_channel_id?: string | null
  customer_id?: string | null
  customer?: { has_account?: boolean | null } | null
  completed_at?: string | Date | null
  total?: unknown
  currency_code?: string | null
  payment_collection?: {
    payment_sessions?: StoreSession[] | null
  } | null
}

export type StoreSession = {
  id: string
  provider_id: string
  status: string
  data?: Record<string, unknown> | null
  created_at?: string | Date | null
}

export type StoreRequester = {
  /** Sales channels of the publishable key the request was made with. */
  salesChannelIds: string[]
  /** Logged-in customer, if any. */
  customerId?: string | null
}

/**
 * A cart is readable when it belongs to the publishable key's sales channel
 * and, if it is tied to a registered customer, only by that customer. The cart
 * id itself is unguessable; these checks keep one storefront's key (or one
 * shopper's session) from reading another's carts.
 */
export function canAccessCart(cart: StoreCart, who: StoreRequester): boolean {
  if (cart.sales_channel_id && !who.salesChannelIds.includes(cart.sales_channel_id)) {
    return false
  }
  if (who.customerId) {
    return cart.customer_id === who.customerId
  }
  return !cart.customer?.has_account
}

export function isDoitProvider(providerId: string | undefined | null): boolean {
  return !!providerId && providerId.startsWith("pp_doit_")
}

/** The cart's current doit session: the newest one that is not canceled. */
export function pickDoitSession(cart: StoreCart): StoreSession | null {
  const sessions = (cart.payment_collection?.payment_sessions ?? []).filter(
    (s) => isDoitProvider(s.provider_id) && s.status !== "canceled"
  )
  sessions.sort((a, b) => String(b.created_at ?? "").localeCompare(String(a.created_at ?? "")))
  return sessions[0] ?? null
}

// ---------------------------------------------------------------- public shape

const PUBLIC_FIELDS = [
  "id",
  "status",
  "rail",
  "va_bank",
  "va_number",
  "qr_content",
  "hosted_url",
  "expires_at",
  "paid_at",
  "amount",
  "fee_amount",
  "fee_payer",
  "total_amount",
  "environment",
] as const

export type PublicDoitPayment = { [K in (typeof PUBLIC_FIELDS)[number]]: unknown }

/** What the storefront may see of a doit payment: no metadata, customer, flags or idempotency keys. */
export function toPublicPayment(data: Record<string, unknown> | null | undefined): PublicDoitPayment {
  const out = {} as PublicDoitPayment
  for (const field of PUBLIC_FIELDS) {
    out[field] = data?.[field] ?? null
  }
  return out
}

/** Statuses that can still change by themselves (expired can turn paid: bayar_telat). */
export function isOpenStatus(status: unknown): boolean {
  return status === "pending" || status === "expired"
}

// ---------------------------------------------------------------- doit.id access

export function providerOptionsFor(container: MedusaContainer, providerId: string): DoitProviderOptions {
  const config = container.resolve(ContainerRegistrationKeys.CONFIG_MODULE)
  return getDoitProviderOptions(config as never, providerId.replace(/^pp_/, "")) ?? {}
}

export async function storeCredentials(
  container: MedusaContainer,
  providerId: string
): Promise<{ creds: DoitCredentials; options: DoitProviderOptions }> {
  const options = providerOptionsFor(container, providerId)
  const creds = await resolveDoitCredentials(
    container.resolve(ContainerRegistrationKeys.PG_CONNECTION),
    options,
    { logger: container.resolve(ContainerRegistrationKeys.LOGGER) }
  )
  return { creds, options }
}

function clientFor(creds: DoitCredentials, options: DoitProviderOptions): DoitClient {
  // Storefront requests wait for nobody: one quick try, no retry sleeps.
  return new DoitClient({
    apiKey: creds.apiKey!,
    baseUrl: options.api_base_url,
    timeoutMs: Math.min(options.request_timeout_ms ?? 8_000, 8_000),
    maxRetries: 0,
  })
}

type Cached<T> = { at: number; value: T }

/**
 * Throttles storefront-driven reads of doit.id: one read per payment per
 * STATUS_REFRESH_MS, concurrent polls share the request in flight, and the
 * process spends at most STATUS_REFRESH_BUDGET_PER_MINUTE reads a minute so
 * webhooks, cart completion and the sync job keep most of the 120/min key limit.
 */
export class StatusRefresher {
  private readonly cache = new Map<string, Cached<DoitPayment>>()
  private readonly inflight = new Map<string, Promise<DoitPayment | null>>()
  private spent = 0
  private windowStart = 0

  constructor(
    private readonly now: () => number = Date.now,
    private readonly refreshMs = STATUS_REFRESH_MS,
    private readonly budget = STATUS_REFRESH_BUDGET_PER_MINUTE
  ) {}

  /** Fresh doit.id payment, a recent cached one, or null when the budget is spent or the read failed. */
  async get(doitId: string, read: () => Promise<DoitPayment>): Promise<{ payment: DoitPayment; checkedAt: number } | null> {
    const now = this.now()
    const hit = this.cache.get(doitId)
    if (hit && now - hit.at < this.refreshMs) {
      return { payment: hit.value, checkedAt: hit.at }
    }
    let pending = this.inflight.get(doitId)
    if (!pending) {
      if (!this.take(now)) {
        return hit ? { payment: hit.value, checkedAt: hit.at } : null
      }
      pending = read()
        .then((payment) => {
          this.remember(doitId, payment)
          return payment
        })
        .catch(() => null)
        .finally(() => this.inflight.delete(doitId))
      this.inflight.set(doitId, pending)
    }
    const payment = await pending
    if (payment) {
      return { payment, checkedAt: this.cache.get(doitId)?.at ?? now }
    }
    return hit ? { payment: hit.value, checkedAt: hit.at } : null
  }

  private take(now: number): boolean {
    if (now - this.windowStart >= 60_000) {
      this.windowStart = now
      this.spent = 0
    }
    if (this.spent >= this.budget) {
      return false
    }
    this.spent++
    return true
  }

  private remember(doitId: string, payment: DoitPayment): void {
    if (this.cache.size > 5_000) {
      const cutoff = this.now() - this.refreshMs
      for (const [key, entry] of this.cache) {
        if (entry.at < cutoff) {
          this.cache.delete(key)
        }
      }
    }
    this.cache.set(doitId, { at: this.now(), value: payment })
  }
}

const REFRESHER_KEY = Symbol.for("medusa-payment-doit.store-status-refresher")
type RefresherHolder = { [REFRESHER_KEY]?: StatusRefresher }

export function statusRefresher(): StatusRefresher {
  const holder = globalThis as RefresherHolder
  return (holder[REFRESHER_KEY] ??= new StatusRefresher())
}

export async function readDoitPayment(
  container: MedusaContainer,
  providerId: string,
  doitId: string
): Promise<{ payment: DoitPayment; checkedAt: number } | null> {
  const { creds, options } = await storeCredentials(container, providerId)
  if (!creds.apiKey) {
    return null
  }
  return statusRefresher().get(doitId, () => clientFor(creds, options).getPayment(doitId))
}

// ---------------------------------------------------------------- methods

export type StoreMethod = {
  code: string
  label: string
  rail: "qris" | "va" | "transfer"
  bank: string | null
  fee_payer: string | null
  fee_amount: number | null
  total_amount: number | null
  within_limits: boolean | null
}

/**
 * Keeps the methods this plugin can create a payment for: QRIS, VA banks in
 * VA_BANKS and transfer banks in TRANSFER_BANKS. Undocumented rails (cc) and
 * methods outside the amount limits are left out.
 */
export function toStoreMethods(data: Record<string, unknown>[] | undefined): StoreMethod[] {
  const out: StoreMethod[] = []
  for (const m of data ?? []) {
    const rail = m.rail
    const bank = typeof m.bank === "string" ? m.bank : null
    const ok =
      rail === "qris" ||
      (rail === "va" && !!bank && (VA_BANKS as readonly string[]).includes(bank)) ||
      (rail === "transfer" && !!bank && (TRANSFER_BANKS as readonly string[]).includes(bank))
    if (!ok || m.within_limits === false) {
      continue
    }
    const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : null)
    out.push({
      code: String(m.code ?? (bank ? `${rail}_${bank}` : rail)),
      label: String(m.label ?? m.code ?? rail),
      rail: rail as StoreMethod["rail"],
      bank,
      fee_payer: typeof m.fee_payer === "string" ? m.fee_payer : null,
      fee_amount: num(m.fee_amount),
      total_amount: num(m.total_amount),
      within_limits: typeof m.within_limits === "boolean" ? m.within_limits : null,
    })
  }
  return out
}

const METHODS_KEY = Symbol.for("medusa-payment-doit.store-methods-cache")
type MethodsHolder = { [METHODS_KEY]?: Map<string, Cached<StoreMethod[]>> }

/** GET /v1/methods for the storefront, cached per key and amount for METHODS_CACHE_MS. */
export async function listStoreMethods(
  creds: DoitCredentials,
  options: DoitProviderOptions,
  amount: number | undefined,
  now: () => number = Date.now
): Promise<StoreMethod[]> {
  const holder = globalThis as MethodsHolder
  const cache = (holder[METHODS_KEY] ??= new Map())
  const key = `${crypto.createHash("sha256").update(creds.apiKey!).digest("hex").slice(0, 16)}:${amount ?? ""}`
  const hit = cache.get(key)
  if (hit && now() - hit.at < METHODS_CACHE_MS) {
    return hit.value
  }
  const result = await clientFor(creds, options).listMethods(amount)
  const methods = toStoreMethods(result.data)
  if (cache.size > 1_000) {
    cache.clear()
  }
  cache.set(key, { at: now(), value: methods })
  return methods
}
