import type { AttentionCode } from "../modules/doitLedger/models/doit-attention"
import type { DoitPayment, DoitWebhookEvent } from "../providers/doit/types"
import { SESSION_ID_PREFIX } from "../providers/doit/webhook"

/** Shape written to doit_payment (upsert key: doit_id). */
export type LedgerPaymentInput = {
  doit_id: string
  reference: string
  session_id: string | null
  status: string
  amount: number
  fee_amount: number
  net_amount: number
  total_amount: number | null
  fee_payer: string | null
  rail: string | null
  va_bank: string | null
  environment: string | null
  flags: string[]
  paid_at: Date | null
  expires_at: Date | null
  doit_created_at: Date | null
  last_synced_at?: Date
  raw: Record<string, unknown>
  // only set when known; never cleared by a later upsert
  order_id?: string
  reconciled_at?: Date
  /**
   * true for a fresh GET from doit.id (sync): its status wins even if it is
   * "lower". Webhook snapshots can be stale or replayed and never move a
   * payment backwards.
   */
  authoritative?: boolean
}

/** Shape written to doit_refund (upsert key: doit_refund_id, else medusa_refund_id). */
export type LedgerRefundInput = {
  doit_refund_id: string | null
  doit_payment_id: string
  medusa_refund_id: string | null
  amount: number
  status: "pending" | "succeeded" | "failed"
  reason: string | null
  source: "api" | "webhook" | "sync"
  webhook_event_id?: string | null
  raw: Record<string, unknown> | null
}

/** Shape written to doit_attention (upsert key: dedupe_key; an open item is not duplicated). */
export type LedgerAttentionInput = {
  code: AttentionCode
  dedupe_key: string
  message: string
  doit_payment_id?: string | null
  session_id?: string | null
  order_id?: string | null
  event_id?: string | null
  amount?: number | null
  details?: Record<string, unknown> | null
}

function toDate(value: unknown): Date | null {
  if (typeof value !== "string" || !value) {
    return null
  }
  const d = new Date(value)
  return Number.isNaN(d.getTime()) ? null : d
}

function toInt(value: unknown, fallback = 0): number {
  const n = typeof value === "string" ? Number(value) : value
  return typeof n === "number" && Number.isFinite(n) ? Math.round(n) : fallback
}

export function sessionIdOf(reference: unknown): string | null {
  return typeof reference === "string" && reference.startsWith(SESSION_ID_PREFIX) ? reference : null
}

/**
 * Net = what the merchant keeps before payouts. With fee_payer "customer" the
 * fee is added on top of the invoice, so the merchant keeps the full amount.
 */
export function netAmount(amount: number, fee: number, feePayer: string | null | undefined): number {
  return feePayer === "customer" ? amount : amount - fee
}

export function toLedgerPayment(p: DoitPayment, extra: Partial<LedgerPaymentInput> = {}): LedgerPaymentInput {
  const amount = toInt(p.amount)
  const fee = toInt(p.fee_amount)
  const feePayer = typeof p.fee_payer === "string" ? p.fee_payer : null
  return {
    doit_id: p.id,
    reference: String(p.reference ?? ""),
    session_id: sessionIdOf(p.reference),
    status: String(p.status),
    amount,
    fee_amount: fee,
    net_amount: netAmount(amount, fee, feePayer),
    total_amount: p.total_amount === null || p.total_amount === undefined ? null : toInt(p.total_amount),
    fee_payer: feePayer,
    rail: typeof p.rail === "string" ? p.rail : null,
    va_bank: typeof p.va_bank === "string" ? p.va_bank : null,
    environment: typeof p.environment === "string" ? p.environment : null,
    flags: Array.isArray(p.flags) ? p.flags.map(String) : [],
    paid_at: toDate(p.paid_at),
    expires_at: toDate(p.expires_at),
    doit_created_at: toDate(p.created_at),
    raw: p as Record<string, unknown>,
    ...extra,
  }
}

export function refundStatus(value: unknown): LedgerRefundInput["status"] {
  if (value === "succeeded" || value === "success" || value === "refunded") {
    return "succeeded"
  }
  if (value === "failed") {
    return "failed"
  }
  return "pending"
}

/**
 * refund.succeeded / refund.failed. The payload shape is not documented, so
 * accept a refund object (`rf_…` with payment_id), a nested `refund`, or a
 * payment object carrying a `refund`. The event type decides the status.
 */
export function parseRefundEvent(event: DoitWebhookEvent): LedgerRefundInput | null {
  if (event.type !== "refund.succeeded" && event.type !== "refund.failed") {
    return null
  }
  const data = (event.data ?? {}) as Record<string, unknown>
  const nested = (data.refund && typeof data.refund === "object" ? data.refund : null) as Record<string, unknown> | null
  const refund = nested ?? data
  const refundId =
    typeof refund.id === "string" && refund.id.startsWith("rf_") ? refund.id : null
  const paymentId =
    (typeof refund.payment_id === "string" && refund.payment_id) ||
    (typeof data.payment_id === "string" && data.payment_id) ||
    (typeof data.id === "string" && data.id.startsWith("pay_") ? data.id : null)
  if (!paymentId) {
    return null
  }
  const amount = toInt(refund.amount ?? data.refund_amount, NaN)
  if (!Number.isFinite(amount)) {
    return null
  }
  return {
    doit_refund_id: refundId,
    doit_payment_id: paymentId,
    medusa_refund_id: null,
    amount,
    status: event.type === "refund.failed" ? "failed" : "succeeded",
    reason:
      (typeof refund.reason === "string" && refund.reason) ||
      (typeof refund.failure_reason === "string" && refund.failure_reason) ||
      null,
    source: "webhook",
    webhook_event_id: event.id,
    raw: data,
  }
}

/** Refunds the provider stored on the Medusa payment's data (POST /refunds responses). */
export function refundsFromPaymentData(data: Record<string, unknown> | null | undefined): LedgerRefundInput[] {
  const list = Array.isArray(data?.refunds) ? (data!.refunds as Record<string, unknown>[]) : []
  const paymentId = typeof data?.id === "string" ? data.id : null
  if (!paymentId) {
    return []
  }
  return list.flatMap((r) => {
    const response = (r.response ?? {}) as Record<string, unknown>
    const amount = toInt(response.amount ?? r.amount, NaN)
    if (!Number.isFinite(amount)) {
      return []
    }
    return [
      {
        doit_refund_id: typeof response.id === "string" ? response.id : null,
        doit_payment_id: paymentId,
        medusa_refund_id: typeof r.idempotency_key === "string" ? r.idempotency_key : null,
        amount,
        status: refundStatus(response.status),
        reason: typeof response.reason === "string" ? response.reason : null,
        source: "api" as const,
        raw: response,
      },
    ]
  })
}

export type ExistingEvent = {
  status: "received" | "processed" | "ignored" | "failed"
  attempts: number
  received_at: Date | string
}

/** Within this window a claimed-but-unfinished event is treated as in flight. */
export const IN_FLIGHT_MS = 5 * 60 * 1000

/**
 * What to do with a delivery whose event id is already in doit_event:
 * - processed / ignored: duplicate, answer 200 and do not queue
 * - received and still being worked on (or retried by the event bus): duplicate
 * - failed (gave up), or claimed long ago and never processed: queue again
 */
export function classifyRedelivery(existing: ExistingEvent, now = Date.now()): "duplicate" | "requeue" {
  if (existing.status === "processed" || existing.status === "ignored") {
    return "duplicate"
  }
  if (existing.status === "failed") {
    return "requeue"
  }
  const receivedAt = new Date(existing.received_at).getTime()
  if (existing.attempts > 0 || now - receivedAt < IN_FLIGHT_MS) {
    return "duplicate"
  }
  return "requeue"
}

export function attention(
  code: AttentionCode,
  key: string,
  message: string,
  extra: Omit<LedgerAttentionInput, "code" | "dedupe_key" | "message"> = {}
): LedgerAttentionInput {
  return { code, dedupe_key: `${code}:${key}`, message, ...extra }
}

/**
 * Compares doit.id's refund total (ledger, succeeded only) with Medusa's for
 * one payment. Returns an attention item when they disagree or the refunds
 * exceed the payment.
 */
export function refundMismatch({
  doitPaymentId,
  amount,
  doitRefunded,
  medusaRefunded,
  sessionId,
  orderId,
}: {
  doitPaymentId: string
  amount: number
  doitRefunded: number
  medusaRefunded: number | null
  sessionId?: string | null
  orderId?: string | null
}): LedgerAttentionInput | null {
  const over = doitRefunded > amount
  const differs = medusaRefunded !== null && medusaRefunded !== doitRefunded
  if (!over && !differs) {
    return null
  }
  const parts = [
    `Total refund doit.id ${doitRefunded}`,
    medusaRefunded !== null ? `Medusa ${medusaRefunded}` : null,
    `nominal ${amount}`,
  ].filter(Boolean)
  return attention(
    "refund_mismatch",
    `${doitPaymentId}:${doitRefunded}:${medusaRefunded ?? "-"}`,
    `${doitPaymentId}: refund tidak cocok (${parts.join(", ")}).${over ? " Refund melebihi nominal pembayaran." : ""} Periksa di portal doit.id dan Medusa.`,
    {
      doit_payment_id: doitPaymentId,
      session_id: sessionId ?? null,
      order_id: orderId ?? null,
      amount: medusaRefunded === null ? doitRefunded - amount : doitRefunded - medusaRefunded,
      details: { doit_refunded: doitRefunded, medusa_refunded: medusaRefunded, payment_amount: amount },
    }
  )
}
