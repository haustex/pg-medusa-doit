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
  resolveDoitCredentials,
} from "../../lib/credentials"
import { SIGNATURE_HEADER, verifySignature } from "./signature"

type InjectedDependencies = {
  logger: Logger
  [ContainerRegistrationKeys.PG_CONNECTION]?: Knex
}

const NOT_IMPLEMENTED = "doit.id provider: implemented in phase 1"

class DoitPaymentProviderService extends AbstractPaymentProvider<DoitProviderOptions> {
  static identifier = "doit"

  protected logger_: Logger
  protected options_: DoitProviderOptions
  protected pg_: Knex | undefined

  static validateOptions(options: Record<string, unknown>): void {
    const ttl = options.credentials_cache_ttl_ms
    if (ttl !== undefined && (typeof ttl !== "number" || ttl < 0)) {
      throw new MedusaError(
        MedusaError.Types.INVALID_DATA,
        "credentials_cache_ttl_ms must be a non-negative number"
      )
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

  async initiatePayment(input: InitiatePaymentInput): Promise<InitiatePaymentOutput> {
    // Phase 0 spike: report where credentials came from, never the secrets.
    const creds = await this.credentials()
    if (!creds.apiKey) {
      throw new MedusaError(
        MedusaError.Types.NOT_ALLOWED,
        "doit.id belum dikonfigurasi: isi API key di Admin → Settings → doit.id."
      )
    }
    return {
      id: `spike_${Date.now()}`,
      status: "pending",
      data: {
        spike: true,
        pid: process.pid,
        credential_source: creds.source,
        api_key_hint: creds.apiKeyHint,
        environment: creds.environment,
        has_webhook_secret: !!creds.webhookSecret,
        rail: creds.rail,
        encryption_status: creds.encryption.status,
        amount: input.amount,
        currency_code: input.currency_code,
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

    const result = verifySignature({
      rawBody: payload.rawData,
      header: payload.headers[SIGNATURE_HEADER] as string | string[] | undefined,
      secret: creds.webhookSecret,
    })
    if (!result.valid) {
      this.logger_.warn(`[doit] Webhook rejected: ${result.reason} (pid ${process.pid}).`)
      return { action: PaymentActions.NOT_SUPPORTED }
    }

    this.logger_.info(
      `[doit] Webhook signature verified (pid ${process.pid}, source ${creds.source}).`
    )
    return { action: PaymentActions.NOT_SUPPORTED }
  }

  async authorizePayment(_: AuthorizePaymentInput): Promise<AuthorizePaymentOutput> {
    throw new MedusaError(MedusaError.Types.NOT_ALLOWED, NOT_IMPLEMENTED)
  }

  async capturePayment(_: CapturePaymentInput): Promise<CapturePaymentOutput> {
    throw new MedusaError(MedusaError.Types.NOT_ALLOWED, NOT_IMPLEMENTED)
  }

  async cancelPayment(input: CancelPaymentInput): Promise<CancelPaymentOutput> {
    return { data: input.data }
  }

  async deletePayment(input: DeletePaymentInput): Promise<DeletePaymentOutput> {
    return { data: input.data }
  }

  async getPaymentStatus(_: GetPaymentStatusInput): Promise<GetPaymentStatusOutput> {
    throw new MedusaError(MedusaError.Types.NOT_ALLOWED, NOT_IMPLEMENTED)
  }

  async refundPayment(_: RefundPaymentInput): Promise<RefundPaymentOutput> {
    throw new MedusaError(MedusaError.Types.NOT_ALLOWED, NOT_IMPLEMENTED)
  }

  async retrievePayment(_: RetrievePaymentInput): Promise<RetrievePaymentOutput> {
    throw new MedusaError(MedusaError.Types.NOT_ALLOWED, NOT_IMPLEMENTED)
  }

  async updatePayment(_: UpdatePaymentInput): Promise<UpdatePaymentOutput> {
    throw new MedusaError(MedusaError.Types.NOT_ALLOWED, NOT_IMPLEMENTED)
  }
}

export default DoitPaymentProviderService
