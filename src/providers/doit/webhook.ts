import { PaymentActions } from "@medusajs/framework/utils"
import type { LatePaymentPolicy } from "../../lib/credentials"
import type { AttentionCode } from "../../modules/doitLedger/models/doit-attention"
import type { DoitPayment, DoitWebhookEvent } from "./types"

export const SESSION_ID_PREFIX = "payses_"

/**
 * The Medusa payment session a doit.id payment belongs to, read through Query
 * (see src/lib/session-state.ts). `null` means unknown: the caller falls back
 * to the plain behaviour, Medusa's capture being idempotent.
 */
export type SessionState = {
  session: {
    id: string
    status: string
    amount: number | null
    deleted: boolean
    /** doit.id payment id currently attached to the session */
    doitPaymentId: string | null
  } | null
  payment: {
    id: string
    captured: boolean
    canceled: boolean
  } | null
}

export type WebhookDecision = {
  action: PaymentActions
  sessionId?: string
  amount?: number
  attention?: { code: AttentionCode; message: string }
}

export function hasFlag(payment: DoitPayment | undefined, flag: string): boolean {
  return Array.isArray(payment?.flags) && payment!.flags!.includes(flag)
}

/**
 * Maps a verified webhook event to a Medusa payment action.
 *
 * The event `type` only says what happened first; `data.status` is the
 * truth (deliveries are at-least-once and unordered). A payment is captured
 * at most once per session: duplicates, a second `payment.paid` for
 * `bayar_ganda`, or late payments on canceled orders never reach Medusa's
 * capture and are reported through `attention` instead. Nothing is
 * refunded automatically.
 */
export function decideWebhookAction(
  event: DoitWebhookEvent,
  state: SessionState | null,
  { latePaymentPolicy = "accept" }: { latePaymentPolicy?: LatePaymentPolicy } = {}
): WebhookDecision {
  const payment = event.data
  if (
    !payment ||
    typeof event.type !== "string" ||
    !event.type.startsWith("payment.") ||
    event.type === "payment.proof_uploaded"
  ) {
    return { action: PaymentActions.NOT_SUPPORTED }
  }

  // Payments created elsewhere (portal links, other integrations on the same key).
  const sessionId =
    typeof payment.reference === "string" && payment.reference.startsWith(SESSION_ID_PREFIX)
      ? payment.reference
      : undefined
  if (!sessionId) {
    return { action: PaymentActions.NOT_SUPPORTED }
  }
  const base = { sessionId, amount: payment.amount }

  switch (payment.status) {
    case "pending":
      return { ...base, action: PaymentActions.PENDING }
    case "expired":
      return { ...base, action: PaymentActions.CANCELED }
    case "failed":
      return { ...base, action: PaymentActions.FAILED }
    case "refunded":
      return { ...base, action: PaymentActions.NOT_SUPPORTED }
    case "paid":
      break
    default:
      return { ...base, action: PaymentActions.NOT_SUPPORTED }
  }

  const late = hasFlag(payment, "bayar_telat")
  const double = hasFlag(payment, "bayar_ganda")
  const ref = `${payment.id} (session ${sessionId})`
  const ignore = (code: AttentionCode, message: string): WebhookDecision => ({
    ...base,
    action: PaymentActions.NOT_SUPPORTED,
    attention: { code, message },
  })

  if (state) {
    if (!state.session || state.session.deleted) {
      return ignore(
        "paid_without_session",
        `${ref} dibayar, tetapi payment session Medusa sudah tidak ada. Penuhi manual atau refund.`
      )
    }
    if (state.session.doitPaymentId && state.session.doitPaymentId !== payment.id) {
      return ignore(
        "superseded_invoice_paid",
        `${ref} dibayar, tetapi session sudah memakai tagihan ${state.session.doitPaymentId}. Refund tagihan lama ini.`
      )
    }
    if (state.payment?.canceled) {
      return ignore(
        "late_payment_canceled",
        `${ref} dibayar${late ? " setelah kedaluwarsa (bayar_telat)" : ""}, tetapi payment Medusa sudah dibatalkan. Putuskan: penuhi pesanan atau refund.`
      )
    }
    if (state.payment?.captured) {
      if (double) {
        return ignore(
          "overpaid",
          `${ref} dibayar dua kali (bayar_ganda); sudah di-capture sekali. Refund kelebihan bayar secara manual.`
        )
      }
      // Duplicate delivery or replay: already captured, nothing to do.
      return { ...base, action: PaymentActions.NOT_SUPPORTED }
    }
    if (state.session.amount !== null && state.session.amount !== payment.amount) {
      return ignore(
        "amount_mismatch",
        `${ref}: nominal doit.id ${payment.amount} berbeda dengan session ${state.session.amount}. Periksa manual.`
      )
    }
  }

  if (late && latePaymentPolicy === "flag") {
    return ignore(
      "late_payment_flagged",
      `${ref} dibayar setelah kedaluwarsa (bayar_telat); late_payment_policy=flag. Terima atau refund manual.`
    )
  }

  return {
    ...base,
    // `amount` is the invoice amount; total_amount may include a customer-paid fee.
    action: PaymentActions.SUCCESSFUL,
    attention: double
      ? {
          code: "overpaid",
          message: `${ref} dibayar lewat dua instrumen (bayar_ganda); di-capture sekali sebesar ${payment.amount}. Refund kelebihan bayar secara manual.`,
        }
      : undefined,
  }
}
