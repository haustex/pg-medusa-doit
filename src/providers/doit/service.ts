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
import { DoitApiError, DoitClient } from "./client"
import { lookupSessionState } from "./medusa-state"
import { SIGNATURE_HEADER, verifySignature } from "./signature"
import { toSessionStatus } from "./status"
import type { CreatePaymentBody, DoitPayment, DoitWebhookEvent } from "./types"
import { assertIdr, resolveRailBank, sanitizeReturnUrl, toRupiah } from "./validation"
import { SESSION_ID_PREFIX, decideWebhookAction } from "./webhook"

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
    previous: DoitSessionData = {}
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

    const body: CreatePaymentBody = {
      amount,
      reference: sessionId,
      rail,
      ...(va_bank ? { va_bank } : {}),
      expires_in: creds.expiresIn,
      ...(sanitizeReturnUrl(input.data?.return_url) ? { return_url: sanitizeReturnUrl(input.data?.return_url) } : {}),
      ...(customerOf(input.context) ? { customer: customerOf(input.context) } : {}),
      metadata: { medusa_payment_session_id: sessionId },
    }
    const idempotencyKey = `${sessionId}-${shortHash(body)}`

    let payment: DoitPayment
    try {
      payment = await client.createPayment(body, idempotencyKey)
    } catch (e) {
      throw toMedusaError(e, "membuat pembayaran")
    }

    const data = toSessionData(payment, {
      ...previous,
      session_id: sessionId,
      idempotency_key: idempotencyKey,
    })
    if (requestedRail) {
      data.requested_rail = requestedRail
    }
    return { payment, data }
  }

  async initiatePayment(input: InitiatePaymentInput): Promise<InitiatePaymentOutput> {
    const { payment, data } = await this.createDoitPayment(input)
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

  async getWebhookActionAndData(
    payload: ProviderWebhookPayload["payload"]
  ): Promise<WebhookActionResult> {
    const creds = await this.credentials()
    if (!creds.webhookSecret) {
      this.logger_.warn("[doit] Webhook ignored: no signing secret configured.")
      return { action: PaymentActions.NOT_SUPPORTED }
    }

    // The route middleware already checked the signature and its timestamp on
    // arrival; this re-check only guards the queued payload, so the timestamp
    // is not checked again (processing can lag behind by webhook_delay + retries).
    const result = verifySignature({
      rawBody: payload.rawData,
      header: payload.headers[SIGNATURE_HEADER] as string | string[] | undefined,
      secret: creds.webhookSecret,
      toleranceSeconds: 0,
    })
    if (!result.valid) {
      this.logger_.warn(`[doit] Webhook rejected in worker: ${result.reason}.`)
      return { action: PaymentActions.NOT_SUPPORTED }
    }

    const event = payload.data as unknown as DoitWebhookEvent
    const payment = event?.data
    const sessionId =
      typeof payment?.reference === "string" && payment.reference.startsWith(SESSION_ID_PREFIX)
        ? payment.reference
        : undefined
    const state =
      sessionId && payment?.status === "paid"
        ? await lookupSessionState(this.pg_, sessionId, this.logger_)
        : null

    const decision = decideWebhookAction(event, state, {
      latePaymentPolicy: this.options_.late_payment_policy,
    })
    if (decision.attention) {
      this.logger_.warn(
        `[doit] PERLU TINDAKAN ${decision.attention.code} (event ${event.id}): ${decision.attention.message}`
      )
    }
    this.logger_.info(
      `[doit] Webhook ${event.id} ${event.type} ${payment?.id ?? "-"} status=${payment?.status ?? "-"} → ${decision.action}`
    )

    if (!decision.sessionId || decision.amount === undefined) {
      return { action: decision.action }
    }
    return {
      action: decision.action,
      data: { session_id: decision.sessionId, amount: decision.amount },
    }
  }
}

export default DoitPaymentProviderService
