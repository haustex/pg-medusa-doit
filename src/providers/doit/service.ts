import crypto from "node:crypto"
import type { Knex } from "@medusajs/framework/mikro-orm/knex"
import type {
  AuthorizePaymentInput,
  AuthorizePaymentOutput,
  CancelPaymentInput,
  CancelPaymentOutput,
  CapturePaymentInput,
  CapturePaymentOutput,
  DeletePaymentInput,
  DeletePaymentOutput,
  GetPaymentStatusInput,
  GetPaymentStatusOutput,
  InitiatePaymentInput,
  InitiatePaymentOutput,
  Logger,
  PaymentProviderContext,
  ProviderWebhookPayload,
  RefundPaymentInput,
  RefundPaymentOutput,
  RetrievePaymentInput,
  RetrievePaymentOutput,
  UpdatePaymentInput,
  UpdatePaymentOutput,
  WebhookActionResult,
} from "@medusajs/framework/types"
import {
  AbstractPaymentProvider,
  ContainerRegistrationKeys,
  MedusaError,
  PaymentActions,
} from "@medusajs/framework/utils"
import {
  DoitCredentials,
  DoitProviderOptions,
  DoitRail,
  resolveDoitCredentials,
} from "../../lib/credentials"
import { referenceFor, STORE_MARKER_KEY, storeIdOf } from "../../lib/ownership"
import { DoitApiError, DoitClient } from "./client"
import { toSessionStatus } from "./status"
import type { CreatePaymentBody, DoitPayment } from "./types"
import { assertIdr, resolveRailBank, sanitizeReturnUrl, toRupiah } from "./validation"

type InjectedDependencies = {
  logger: Logger
  [ContainerRegistrationKeys.PG_CONNECTION]?: Knex
}

/** Fields of the doit.id payment kept on the Medusa payment session / payment. */
const SESSION_FIELDS = [
  "id",
  "status",
  "amount",
  "rail",
  "va_bank",
  "va_number",
  "qr_content",
  "hosted_url",
  "return_url",
  "fee_amount",
  "fee_payer",
  "total_amount",
  "environment",
  "expires_at",
  "paid_at",
  "flags",
] as const

export type DoitSessionData = {
  session_id?: string
  idempotency_key?: string
  /** doit.id invoices this session used before the amount changed */
  superseded_ids?: string[]
  refunds?: { idempotency_key: string; amount: number; response: Record<string, unknown> }[]
  [key: string]: unknown
}

export function toSessionData(payment: DoitPayment, previous: DoitSessionData = {}): DoitSessionData {
  const data: DoitSessionData = { ...previous }
  for (const field of SESSION_FIELDS) {
    data[field] = payment[field] ?? null
  }
  return data
}

/** Maps a doit.id error to a MedusaError; never includes the API key. */
export function toMedusaError(e: unknown, action: string): Error {
  if (!(e instanceof DoitApiError)) {
    return e instanceof Error ? e : new Error(String(e))
  }
  const message = `doit.id ${action} gagal (${e.code}): ${e.message}`
  if (e.status === 401 || e.status === 403) {
    return new MedusaError(MedusaError.Types.NOT_ALLOWED, `${message}. Periksa API key di Admin.`)
  }
  if (e.status === 404) {
    return new MedusaError(MedusaError.Types.NOT_FOUND, message)
  }
  if (e.status === 409) {
    return new MedusaError(MedusaError.Types.NOT_ALLOWED, message)
  }
  if (e.status >= 400 && e.status < 500 && e.status !== 429) {
    return new MedusaError(MedusaError.Types.INVALID_DATA, message)
  }
  return new MedusaError(
    MedusaError.Types.UNEXPECTED_STATE,
    `${message}. Bersifat sementara, coba lagi.`
  )
}

/** A reused VA / transfer invoice must still be payable for at least this long. */
export const REUSE_MIN_REMAINING_MS = 5 * 60_000
/** A reused QRIS invoice must be younger than this: its QR image lives ≈10 minutes. */
export const REUSE_QRIS_MAX_AGE_MS = 8 * 60_000

/**
 * Whether an existing doit.id invoice can serve a new session of the same
 * payment collection: still pending, same amount, same rail and bank, and
 * payable long enough (QRIS: QR still issued and recent).
 */
export function isReusableInvoice(
  p: DoitPayment,
  want: { collectionId: string; amount: number; rail: string; va_bank?: string | null },
  now = Date.now()
): boolean {
  const meta = (p.metadata ?? {}) as Record<string, unknown>
  if (p.status !== "pending" || meta.medusa_payment_collection_id !== want.collectionId) {
    return false
  }
  if (p.amount !== want.amount || p.rail !== want.rail) {
    return false
  }
  const expires = p.expires_at ? Date.parse(p.expires_at) : NaN
  if (!Number.isFinite(expires) || expires - now < REUSE_MIN_REMAINING_MS) {
    return false
  }
  if (want.rail === "qris") {
    const created = p.created_at ? Date.parse(p.created_at) : NaN
    return !!p.qr_content && Number.isFinite(created) && now - created < REUSE_QRIS_MAX_AGE_MS
  }
  return (p.va_bank ?? null) === (want.va_bank ?? null)
}

function shortHash(value: unknown): string {
  return crypto.createHash("sha256").update(JSON.stringify(value)).digest("hex").slice(0, 16)
}

function customerOf(context: PaymentProviderContext | undefined): CreatePaymentBody["customer"] {
  const c = context?.customer
  if (!c) {
    return undefined
  }
  const name = [c.first_name, c.last_name].filter(Boolean).join(" ").trim() || c.company_name || undefined
  const phone = c.phone || c.billing_address?.phone || undefined
  if (!name && !phone && !c.email) {
    return undefined
  }
  // The name is shown on the VA; doit.id also stores and echoes email.
  return {
    ...(name ? { name: name.slice(0, 100) } : {}),
    ...(phone ? { phone } : {}),
    ...(c.email ? { email: c.email } : {}),
  }
}

class DoitPaymentProviderService extends AbstractPaymentProvider<DoitProviderOptions> {
  static identifier = "doit"

  protected logger_: Logger
  protected options_: DoitProviderOptions
  protected pg_: Knex | undefined

  static validateOptions(options: Record<string, unknown>): void {
    for (const key of [
      "credentials_cache_ttl_ms",
      "request_timeout_ms",
      "max_retries",
      "max_retry_wait_ms",
    ]) {
      const value = options[key]
      if (value !== undefined && (typeof value !== "number" || value < 0)) {
        throw new MedusaError(MedusaError.Types.INVALID_DATA, `${key} must be a non-negative number`)
      }
    }
    const policy = options.late_payment_policy
    if (policy !== undefined && policy !== "accept" && policy !== "flag") {
      throw new MedusaError(
        MedusaError.Types.INVALID_DATA,
        `late_payment_policy must be "accept" or "flag"`
      )
    }
    const rail = options.rail
    if (rail !== undefined && !["any", "qris", "va", "transfer"].includes(rail as string)) {
      throw new MedusaError(MedusaError.Types.INVALID_DATA, "rail must be any, qris, va or transfer")
    }
  }

  constructor(container: InjectedDependencies, options: DoitProviderOptions = {}) {
    super(container, options)
    this.logger_ = container.logger
    this.options_ = options
    // The payment module's container forwards the shared connection; resolving
    // it lazily-by-property keeps the provider usable when it is absent.
    try {
      this.pg_ = container[ContainerRegistrationKeys.PG_CONNECTION]
    } catch {
      this.pg_ = undefined
    }
  }

  protected async credentials(): Promise<DoitCredentials> {
    const creds = await resolveDoitCredentials(this.pg_, this.options_, {
      logger: this.logger_,
    })
    if (creds.adminUnavailable) {
      this.logger_.warn(
        `[doit] Admin credentials unusable (encryption key ${creds.encryption.status}); using ${creds.source}.`
      )
    }
    return creds
  }

  protected async client(): Promise<{ client: DoitClient; creds: DoitCredentials }> {
    const creds = await this.credentials()
    if (!creds.apiKey) {
      throw new MedusaError(
        MedusaError.Types.NOT_ALLOWED,
        "doit.id belum dikonfigurasi: isi API key di Admin → Settings → doit.id."
      )
    }
    const client = new DoitClient({
      apiKey: creds.apiKey,
      baseUrl: this.options_.api_base_url,
      timeoutMs: this.options_.request_timeout_ms,
      maxRetries: this.options_.max_retries,
      maxRetryWaitMs: this.options_.max_retry_wait_ms,
    })
    return { client, creds }
  }

  /** The session's payment collection, read from the payment module's own table. */
  protected async collectionIdOf(sessionId: string): Promise<string | null> {
    if (!this.pg_) {
      return null
    }
    try {
      const row = await this.pg_("payment_session").select("payment_collection_id").where({ id: sessionId }).first()
      return (row?.payment_collection_id as string | undefined) ?? null
    } catch {
      return null
    }
  }

  /**
   * Medusa replaces (and hard-deletes) a collection's session whenever the
   * shopper changes method, so the earlier invoice is only known to doit.id.
   * Looks among the newest pending invoices for one of this collection that
   * still fits, and confirms it with a fresh read. Any failure → null (a new
   * invoice is created).
   */
  protected async findReusableInvoice(
    client: DoitClient,
    want: { collectionId: string; amount: number; rail: string; va_bank?: string | null }
  ): Promise<DoitPayment | null> {
    if (want.rail === "any") {
      return null
    }
    try {
      const { data } = await client.listPayments({ status: "pending", limit: 100 })
      const candidates = (data ?? [])
        .filter((p) => isReusableInvoice(p, want))
        .sort((a, b) => String(b.created_at ?? "").localeCompare(String(a.created_at ?? "")))
      for (const candidate of candidates.slice(0, 2)) {
        const fresh = await client.getPayment(candidate.id)
        if (isReusableInvoice(fresh, want)) {
          return fresh
        }
      }
    } catch (e) {
      this.logger_.warn(`[doit] Invoice reuse lookup failed, creating a new one: ${(e as Error).message}`)
    }
    return null
  }

  protected doitId(data: Record<string, unknown> | undefined): string {
    const id = data?.id
    if (typeof id !== "string" || !id.startsWith("pay_")) {
      throw new MedusaError(
        MedusaError.Types.INVALID_DATA,
        "Data payment tidak memuat id pembayaran doit.id (pay_…)."
      )
    }
    return id
  }

  /**
   * Creates a doit.id payment for a session. The Idempotency-Key is the session
   * id plus a hash of the request, so a retried call replays the same invoice
   * while a changed amount / rail creates a new one.
   */
  protected async createDoitPayment(
    input: InitiatePaymentInput | UpdatePaymentInput,
    previous: DoitSessionData = {},
    { allowReuse = false }: { allowReuse?: boolean } = {}
  ): Promise<{ payment: DoitPayment; data: DoitSessionData }> {
    assertIdr(input.currency_code)
    const amount = toRupiah(input.amount)
    const sessionId =
      (typeof input.data?.session_id === "string" && input.data.session_id) ||
      previous.session_id ||
      input.context?.idempotency_key
    if (!sessionId) {
      throw new MedusaError(MedusaError.Types.INVALID_DATA, "doit.id: payment session id tidak tersedia.")
    }

    const { client, creds } = await this.client()
    // The storefront may pick the method (e.g. QRIS vs a VA bank); otherwise the Admin default.
    const requestedRail = input.data?.rail as DoitRail | undefined
    const { rail, va_bank } = resolveRailBank(
      requestedRail ?? creds.rail,
      requestedRail ? (input.data?.va_bank as string | undefined) : creds.vaBank
    )

    const collectionId = await this.collectionIdOf(sessionId)
    // Marks the payment as this store's: reconciliation ignores payments without it
    // (other apps or stores on the same doit.id key, portal links).
    const storeId = await storeIdOf(this.pg_)
    const body: CreatePaymentBody = {
      amount,
      reference: referenceFor(sessionId, creds.referencePrefix),
      rail,
      ...(va_bank ? { va_bank } : {}),
      expires_in: creds.expiresIn,
      ...(sanitizeReturnUrl(input.data?.return_url) ? { return_url: sanitizeReturnUrl(input.data?.return_url) } : {}),
      ...(customerOf(input.context) ? { customer: customerOf(input.context) } : {}),
      metadata: {
        ...(storeId ? { [STORE_MARKER_KEY]: storeId } : {}),
        medusa_payment_session_id: sessionId,
        ...(collectionId ? { medusa_payment_collection_id: collectionId } : {}),
      },
    }
    const idempotencyKey = `${sessionId}-${shortHash(body)}`

    const reused =
      allowReuse && collectionId
        ? await this.findReusableInvoice(client, { collectionId, amount, rail, va_bank })
        : null
    let payment: DoitPayment
    if (reused) {
      payment = reused
      this.logger_.info(`[doit] Session ${sessionId} reuses invoice ${reused.id} (${rail}${va_bank ? ` ${va_bank}` : ""}).`)
    } else {
      try {
        payment = await client.createPayment(body, idempotencyKey)
      } catch (e) {
        throw toMedusaError(e, "membuat pembayaran")
      }
    }

    const data = toSessionData(payment, {
      ...previous,
      session_id: sessionId,
      idempotency_key: idempotencyKey,
      ...(collectionId ? { payment_collection_id: collectionId } : {}),
      ...(reused ? { reused_invoice: true } : {}),
    })
    if (requestedRail) {
      data.requested_rail = requestedRail
    }
    return { payment, data }
  }

  async initiatePayment(input: InitiatePaymentInput): Promise<InitiatePaymentOutput> {
    const { payment, data } = await this.createDoitPayment(input, {}, { allowReuse: true })
    return { id: payment.id, status: toSessionStatus(payment.status), data }
  }

  async updatePayment(input: UpdatePaymentInput): Promise<UpdatePaymentOutput> {
    const previous = (input.data ?? {}) as DoitSessionData
    const amount = toRupiah(input.amount)
    if (typeof previous.id === "string" && previous.amount === amount && previous.status === "pending") {
      assertIdr(input.currency_code)
      return { status: toSessionStatus("pending"), data: previous }
    }

    // There is no cancel endpoint: the old invoice stays payable until it
    // expires. If it gets paid anyway the webhook reports it (superseded_invoice_paid).
    const superseded = [...(previous.superseded_ids ?? [])]
    if (typeof previous.id === "string" && previous.id !== "") {
      superseded.push(previous.id)
    }
    const { payment, data } = await this.createDoitPayment(input, {
      ...previous,
      ...(superseded.length ? { superseded_ids: superseded } : {}),
    })
    return { status: toSessionStatus(payment.status), data }
  }

  protected async fetchStatus(
    data: Record<string, unknown> | undefined
  ): Promise<{ payment: DoitPayment; data: DoitSessionData }> {
    const id = this.doitId(data)
    const { client } = await this.client()
    try {
      const payment = await client.getPayment(id)
      return { payment, data: toSessionData(payment, data as DoitSessionData) }
    } catch (e) {
      throw toMedusaError(e, "membaca status pembayaran")
    }
  }

  /**
   * Called when the cart is completed and by the webhook flow. doit.id settles
   * immediately, so a paid payment is reported as captured; a pending one
   * keeps the cart open until the payment.paid webhook completes it.
   */
  async authorizePayment(input: AuthorizePaymentInput): Promise<AuthorizePaymentOutput> {
    const { payment, data } = await this.fetchStatus(input.data)
    return { status: toSessionStatus(payment.status), data }
  }

  async getPaymentStatus(input: GetPaymentStatusInput): Promise<GetPaymentStatusOutput> {
    const { payment, data } = await this.fetchStatus(input.data)
    return { status: toSessionStatus(payment.status), data }
  }

  async retrievePayment(input: RetrievePaymentInput): Promise<RetrievePaymentOutput> {
    const { data } = await this.fetchStatus(input.data)
    return { data }
  }

  /** doit.id has no separate capture: a paid payment is already settled. */
  async capturePayment(input: CapturePaymentInput): Promise<CapturePaymentOutput> {
    return { data: input.data }
  }

  /**
   * doit.id has no cancel endpoint; the invoice simply expires. A payment that
   * still arrives afterwards is reported by the webhook as late_payment_canceled.
   */
  async cancelPayment(input: CancelPaymentInput): Promise<CancelPaymentOutput> {
    return { data: { ...(input.data ?? {}), canceled_locally: true } }
  }

  async deletePayment(input: DeletePaymentInput): Promise<DeletePaymentOutput> {
    return { data: input.data }
  }

  async refundPayment(input: RefundPaymentInput): Promise<RefundPaymentOutput> {
    const data = (input.data ?? {}) as DoitSessionData
    const id = this.doitId(data)
    const amount = toRupiah(input.amount, "Nominal refund")
    const previousRefunds = data.refunds ?? []
    // The sandbox accepted refunds beyond the remaining amount (201, not the
    // documented 400 invalid_refund_amount), so do not rely on doit.id for this.
    const refunded = previousRefunds.reduce((sum, r) => sum + (Number(r.amount) || 0), 0)
    if (typeof data.amount === "number" && refunded + amount > data.amount) {
      throw new MedusaError(
        MedusaError.Types.INVALID_DATA,
        `Refund ${amount} melebihi sisa ${data.amount - refunded} dari pembayaran ${id}.`
      )
    }
    // Medusa passes the refund id; the fallback stays stable across retries of the same refund.
    const idempotencyKey =
      input.context?.idempotency_key ?? `${id}-refund-${previousRefunds.length + 1}-${amount}`

    const { client } = await this.client()
    let response: Record<string, unknown>
    try {
      response = await client.createRefund(
        id,
        { amount, reason: "Refund dari Medusa" },
        idempotencyKey
      )
    } catch (e) {
      throw toMedusaError(e, "refund")
    }

    return {
      data: {
        ...data,
        refunds: [...previousRefunds, { idempotency_key: idempotencyKey, amount, response }],
      },
    }
  }

  /**
   * Always not_supported: doit.id webhooks are handled by the plugin's own
   * subscriber (src/subscribers/doit-webhook-received.ts), which can write the
   * ledger, count attempts and read the Medusa state through Query. This
   * provider's container cannot reach other modules, so answering an action
   * here would let Medusa's handler capture without any of that.
   */
  async getWebhookActionAndData(
    _payload: ProviderWebhookPayload["payload"]
  ): Promise<WebhookActionResult> {
    return { action: PaymentActions.NOT_SUPPORTED }
  }
}

export default DoitPaymentProviderService
