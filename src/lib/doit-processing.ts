import type { MedusaContainer } from "@medusajs/framework/types"
import { ContainerRegistrationKeys, PaymentActions } from "@medusajs/framework/utils"
import { processPaymentWorkflow } from "@medusajs/medusa/core-flows"
import { DOIT_LEDGER_MODULE } from "../modules/doitLedger"
import type DoitLedgerModuleService from "../modules/doitLedger/service"
import type { DoitPayment, DoitWebhookEvent } from "../providers/doit/types"
import { SIGNATURE_HEADER, verifySignature } from "../providers/doit/signature"
import { decideWebhookAction } from "../providers/doit/webhook"
import { recordDoitLedgerWorkflow } from "../workflows/record-doit-ledger"
import { resolveDoitCredentials, type DoitProviderOptions } from "./credentials"
import {
  attention,
  type LedgerAttentionInput,
  type LedgerPaymentInput,
  parseRefundEvent,
  refundMismatch,
  refundsFromPaymentData,
  sessionIdOf,
  toLedgerPayment,
} from "./ledger"
import { getDoitProviderOptions } from "./provider-options"
import { loadSessionContext } from "./session-state"

type Logger = { info: (m: string) => void; warn: (m: string) => void; error: (m: string) => void }

export const DEFAULT_WEBHOOK_ATTEMPTS = 3

function logger(container: MedusaContainer): Logger {
  return container.resolve(ContainerRegistrationKeys.LOGGER) as Logger
}

function ledgerService(container: MedusaContainer): DoitLedgerModuleService {
  return container.resolve(DOIT_LEDGER_MODULE) as DoitLedgerModuleService
}

function paymentModuleOptions(container: MedusaContainer): Record<string, unknown> {
  const config = container.resolve(ContainerRegistrationKeys.CONFIG_MODULE) as {
    modules?: Record<string, { options?: Record<string, unknown> } | boolean | string>
  }
  const payment = config.modules?.payment
  return typeof payment === "object" && payment ? payment.options ?? {} : {}
}

/** Same value Medusa's webhook route passes to the event bus as `attempts`. */
export function webhookAttempts(container: MedusaContainer): number {
  const n = Number(paymentModuleOptions(container).webhook_retries)
  return Number.isInteger(n) && n > 0 ? n : DEFAULT_WEBHOOK_ATTEMPTS
}

export type SettleResult = {
  payment: LedgerPaymentInput
  attentions: LedgerAttentionInput[]
  captured: boolean
}

/**
 * Brings Medusa in line with a doit.id payment that is `paid`: captures the
 * session once (Medusa re-reads the status from doit.id while authorizing),
 * or raises a "perlu tindakan" item for the cases a person has to decide.
 * Shared by the webhook subscriber and the sync job. Throws when the capture
 * workflow fails, so the caller can count attempts.
 */
export async function settlePaidPayment(
  container: MedusaContainer,
  payment: DoitPayment,
  { options, eventId }: { options: DoitProviderOptions; eventId?: string }
): Promise<SettleResult> {
  const log = logger(container)
  const sessionId = sessionIdOf(payment.reference)
  const ledgerPayment = toLedgerPayment(payment)
  if (!sessionId) {
    return { payment: ledgerPayment, attentions: [], captured: false }
  }

  const context = await loadSessionContext(container, sessionId, log)
  const decision = decideWebhookAction(
    { id: eventId ?? "sync", type: "payment.paid", data: payment },
    context?.state ?? null,
    { latePaymentPolicy: options.late_payment_policy }
  )

  const attentions: LedgerAttentionInput[] = []
  if (decision.attention) {
    attentions.push(
      attention(decision.attention.code, payment.id, decision.attention.message, {
        doit_payment_id: payment.id,
        session_id: sessionId,
        order_id: context?.orderId ?? null,
        event_id: eventId ?? null,
        // The excess of a bayar_ganda payment is not in any documented field yet.
        amount: decision.attention.code === "overpaid" ? null : payment.amount,
        details: {
          flags: payment.flags ?? [],
          status: payment.status,
          amount: payment.amount,
          total_amount: payment.total_amount ?? null,
        },
      })
    )
    log.warn(`[doit] PERLU TINDAKAN ${decision.attention.code}: ${decision.attention.message}`)
  }

  let captured = !!context?.state.payment?.captured
  if (decision.action === PaymentActions.SUCCESSFUL) {
    await processPaymentWorkflow(container).run({
      input: { action: PaymentActions.SUCCESSFUL, data: { session_id: sessionId, amount: payment.amount } },
    })
    captured = true
  }

  let orderId = context?.orderId ?? null
  if (captured && !orderId) {
    orderId = (await loadSessionContext(container, sessionId, log))?.orderId ?? null
  }
  // Settled on the Medusa side once captured or handed to a person.
  const settled = captured || attentions.length > 0
  return {
    payment: {
      ...ledgerPayment,
      ...(orderId ? { order_id: orderId } : {}),
      ...(settled ? { reconciled_at: new Date() } : {}),
    },
    attentions,
    captured,
  }
}

/**
 * Compares the ledger refund total of each payment with Medusa's and raises
 * refund_mismatch where they disagree (or the refunds exceed the payment).
 */
export async function checkRefundTotals(
  container: MedusaContainer,
  totals: { doit_id: string; amount: number; refunded_amount: number; session_id: string | null; order_id: string | null }[]
): Promise<LedgerAttentionInput[]> {
  const items: LedgerAttentionInput[] = []
  for (const t of totals) {
    const context = t.session_id ? await loadSessionContext(container, t.session_id, logger(container)) : null
    const item = refundMismatch({
      doitPaymentId: t.doit_id,
      amount: t.amount,
      doitRefunded: t.refunded_amount,
      medusaRefunded: context?.medusaRefunded ?? null,
      sessionId: t.session_id,
      orderId: t.order_id ?? context?.orderId ?? null,
    })
    if (item) {
      items.push(item)
    }
  }
  if (items.length) {
    await recordDoitLedgerWorkflow(container).run({ input: { attentions: items } })
    for (const i of items) logger(container).warn(`[doit] PERLU TINDAKAN refund_mismatch: ${i.message}`)
  }
  return items
}

export type WebhookEventData = {
  provider: string
  payload: { data: Record<string, unknown>; rawData: unknown; headers: Record<string, unknown> }
}

/**
 * Worker side of a doit.id webhook (subscriber on payment.webhook_received).
 * Re-verifies the HMAC, writes the ledger, settles paid payments and counts
 * attempts in doit_event. A failure is rethrown so the event bus retries it;
 * on the last attempt the event is marked failed and a webhook_failed item
 * is raised instead.
 */
export async function handleDoitWebhook(container: MedusaContainer, input: WebhookEventData): Promise<void> {
  const config = container.resolve(ContainerRegistrationKeys.CONFIG_MODULE)
  const options = getDoitProviderOptions(config as never, input.provider ?? "")
  if (!options) {
    return
  }
  const log = logger(container)
  const creds = await resolveDoitCredentials(
    container.resolve(ContainerRegistrationKeys.PG_CONNECTION),
    options,
    { logger: log }
  )
  if (!creds.webhookSecret) {
    log.warn("[doit] Webhook ignored in worker: no signing secret configured.")
    return
  }
  // The middleware checked the timestamp on arrival; processing may lag behind.
  const verified = verifySignature({
    rawBody: input.payload?.rawData,
    header: input.payload?.headers?.[SIGNATURE_HEADER] as string | string[] | undefined,
    secret: creds.webhookSecret,
    toleranceSeconds: 0,
  })
  if (!verified.valid) {
    log.warn(`[doit] Webhook rejected in worker: ${verified.reason}.`)
    return
  }

  const event = input.payload.data as unknown as DoitWebhookEvent
  if (typeof event?.id !== "string" || typeof event?.type !== "string") {
    log.warn("[doit] Webhook without event id/type ignored.")
    return
  }
  const service = ledgerService(container)
  const [existing] = await service.listDoitEvents({ event_id: event.id }, { take: 1 })
  if (existing && (existing.status === "processed" || existing.status === "ignored")) {
    log.info(`[doit] Webhook ${event.id} already processed.`)
    return
  }

  const attempts = (existing?.attempts ?? 0) + 1
  const payment = event.type.startsWith("payment.") || event.type === "invoice.created" ? event.data : undefined
  const isPayment = !!payment && typeof payment.id === "string" && payment.id.startsWith("pay_")
  const refund = parseRefundEvent(event)
  const eventBase = {
    event_id: event.id,
    type: event.type,
    doit_payment_id: isPayment ? payment!.id : refund?.doit_payment_id ?? null,
    payload: event as unknown as Record<string, unknown>,
  }

  try {
    if (refund) {
      const { result } = await recordDoitLedgerWorkflow(container).run({
        input: {
          refunds: [refund],
          attentions:
            refund.status === "failed"
              ? [
                  attention(
                    "refund_failed",
                    refund.doit_refund_id ?? `${refund.doit_payment_id}:${event.id}`,
                    `Refund ${refund.amount} untuk ${refund.doit_payment_id} gagal di doit.id${refund.reason ? `: ${refund.reason}` : ""}. Medusa mungkin sudah mencatatnya sebagai refund; periksa dan ulangi atau kembalikan manual.`,
                    { doit_payment_id: refund.doit_payment_id, event_id: event.id, amount: refund.amount }
                  ),
                ]
              : [],
          event: { ...eventBase, status: "processed", attempts, processed_at: new Date(), last_error: null },
        },
      })
      await checkRefundTotals(container, result.totals)
      log.info(`[doit] Webhook ${event.id} ${event.type} ${refund.doit_payment_id} ${refund.amount} recorded.`)
      return
    }

    if (!isPayment) {
      await recordDoitLedgerWorkflow(container).run({
        input: { event: { ...eventBase, status: "ignored", attempts, processed_at: new Date() } },
      })
      log.info(`[doit] Webhook ${event.id} ${event.type} ignored.`)
      return
    }

    // The ledger reflects doit.id even if settling in Medusa fails below.
    await recordDoitLedgerWorkflow(container).run({ input: { payments: [toLedgerPayment(payment!)] } })

    let settled: SettleResult | null = null
    if (payment!.status === "paid") {
      settled = await settlePaidPayment(container, payment!, { options, eventId: event.id })
    }
    await recordDoitLedgerWorkflow(container).run({
      input: {
        payments: settled ? [settled.payment] : [],
        attentions: settled?.attentions ?? [],
        resolve_attentions: [{ dedupe_key: `webhook_failed:${event.id}`, note: "Diproses ulang dengan sukses." }],
        event: { ...eventBase, status: "processed", attempts, processed_at: new Date(), last_error: null },
      },
    })
    log.info(
      `[doit] Webhook ${event.id} ${event.type} ${payment!.id} status=${payment!.status}${settled ? ` captured=${settled.captured}` : ""}`
    )
  } catch (e) {
    const message = (e as Error)?.message ?? String(e)
    const gaveUp = attempts >= webhookAttempts(container)
    await recordDoitLedgerWorkflow(container).run({
      input: {
        event: { ...eventBase, status: gaveUp ? "failed" : "received", attempts, last_error: message.slice(0, 2000) },
        attentions: gaveUp
          ? [
              attention(
                "webhook_failed",
                event.id,
                `Webhook ${event.id} (${event.type}${eventBase.doit_payment_id ? `, ${eventBase.doit_payment_id}` : ""}) gagal diproses setelah ${attempts} percobaan: ${message.slice(0, 300)}`,
                {
                  doit_payment_id: eventBase.doit_payment_id,
                  session_id: isPayment ? sessionIdOf(payment!.reference) : null,
                  event_id: event.id,
                }
              ),
            ]
          : [],
      },
    })
    if (gaveUp) {
      log.error(`[doit] PERLU TINDAKAN webhook_failed: ${event.id} gave up after ${attempts} attempts: ${message}`)
      return
    }
    log.warn(`[doit] Webhook ${event.id} attempt ${attempts} failed: ${message}`)
    throw e
  }
}

/**
 * payment.refunded: copies the doit.id refund responses the provider stored on
 * the Medusa payment into the ledger, then checks the totals.
 */
export async function handleMedusaRefund(container: MedusaContainer, paymentId: string): Promise<void> {
  const query = container.resolve(ContainerRegistrationKeys.QUERY)
  const { data } = await query.graph({
    entity: "payment",
    fields: ["id", "provider_id", "data", "payment_session_id"],
    filters: { id: paymentId },
  })
  const payment = data[0] as { provider_id?: string; data?: Record<string, unknown> } | undefined
  if (!payment?.provider_id?.startsWith("pp_doit_")) {
    return
  }
  const refunds = refundsFromPaymentData(payment.data)
  if (!refunds.length) {
    return
  }
  const { result } = await recordDoitLedgerWorkflow(container).run({ input: { refunds } })
  await checkRefundTotals(container, result.totals)
  logger(container).info(`[doit] Refunds of ${paymentId} recorded (${refunds.length}).`)
}
