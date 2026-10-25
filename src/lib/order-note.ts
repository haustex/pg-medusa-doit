/** What the plugin writes to `order.metadata.doit` once an order is paid through doit.id. */
export type DoitOrderNote = {
  payment_id: string
  rail: string | null
  va_bank: string | null
  /** invoice amount = what Medusa captured */
  amount: number | null
  fee_amount: number | null
  fee_payer: "merchant" | "customer" | null
  /** what the shopper actually paid (amount + fee when the customer pays it) */
  total_amount: number | null
  /** fee paid by the shopper on top of the order total (0 when the store pays it) */
  customer_fee: number
  /** fee deducted from the store's settlement (0 when the shopper pays it) */
  merchant_fee: number
  paid_at: string | null
  environment: string | null
}

const int = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null)
const str = (v: unknown): string | null => (typeof v === "string" && v ? v : null)

/**
 * Builds the note from the doit.id payment (or the session data copied onto
 * the Medusa payment). Null when it is not a doit.id payment.
 */
export function toOrderNote(data: Record<string, unknown> | null | undefined): DoitOrderNote | null {
  const id = data?.id
  if (typeof id !== "string" || !id.startsWith("pay_")) {
    return null
  }
  const fee = int(data!.fee_amount)
  const payer = data!.fee_payer === "customer" || data!.fee_payer === "merchant" ? data!.fee_payer : null
  return {
    payment_id: id,
    rail: str(data!.rail) ?? str(data!.requested_rail),
    va_bank: str(data!.va_bank),
    amount: int(data!.amount),
    fee_amount: fee,
    fee_payer: payer,
    total_amount: int(data!.total_amount),
    customer_fee: payer === "customer" ? fee ?? 0 : 0,
    merchant_fee: payer === "merchant" ? fee ?? 0 : 0,
    paid_at: str(data!.paid_at),
    environment: str(data!.environment),
  }
}
