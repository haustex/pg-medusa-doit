import type { DoitRail } from "../../lib/credentials"

export type DoitPaymentStatus = "pending" | "paid" | "expired" | "failed" | "refunded"

export type DoitFlag = "bayar_telat" | "bayar_ganda" | "lunas_manual" | (string & {})

/** Payment object as returned by POST/GET /v1/payments and inside webhooks. */
export type DoitPayment = {
  id: string
  status: DoitPaymentStatus
  amount: number
  rail: DoitRail | null
  reference: string
  qr_content?: string | null
  va_number?: string | null
  va_bank?: string | null
  hosted_url?: string | null
  return_url?: string | null
  fee_amount?: number | null
  fee_payer?: "merchant" | "customer" | null
  total_amount?: number | null
  provider?: string | null
  provider_ref?: string | null
  environment?: string | null
  expires_at?: string | null
  paid_at?: string | null
  created_at?: string | null
  metadata?: Record<string, unknown> | null
  flags?: DoitFlag[] | null
  [key: string]: unknown
}

export type DoitWebhookEvent = {
  id: string
  type: string
  created_at?: string
  data?: DoitPayment
}

export type CreatePaymentBody = {
  amount: number
  reference: string
  rail: DoitRail
  va_bank?: string
  expires_in?: number
  return_url?: string
  customer?: { name?: string; phone?: string; email?: string }
  metadata?: Record<string, unknown>
}

export type RefundBody = {
  amount?: number
  reason?: string
}
