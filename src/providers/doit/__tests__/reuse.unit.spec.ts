import { isReusableInvoice, REUSE_MIN_REMAINING_MS, REUSE_QRIS_MAX_AGE_MS } from "../service"
import type { DoitPayment } from "../types"

const now = Date.parse("2026-10-25T10:00:00Z")
const iso = (ms: number) => new Date(now + ms).toISOString()
const va = (over: Partial<DoitPayment> = {}): DoitPayment => ({
  id: "pay_va",
  status: "pending",
  amount: 170000,
  rail: "va",
  va_bank: "bmri",
  reference: "payses_old",
  expires_at: iso(60 * 60_000),
  created_at: iso(-60_000),
  metadata: { medusa_payment_collection_id: "pay_col_1" },
  ...over,
})
const want = { collectionId: "pay_col_1", amount: 170000, rail: "va", va_bank: "bmri" }

describe("isReusableInvoice", () => {
  it("reuses a pending VA invoice of the same collection, amount and bank", () => {
    expect(isReusableInvoice(va(), want, now)).toBe(true)
  })
  it("never another cart's invoice, another amount, rail or bank", () => {
    expect(isReusableInvoice(va({ metadata: { medusa_payment_collection_id: "pay_col_2" } }), want, now)).toBe(false)
    expect(isReusableInvoice(va({ metadata: null }), want, now)).toBe(false)
    expect(isReusableInvoice(va({ amount: 150000 }), want, now)).toBe(false)
    expect(isReusableInvoice(va({ va_bank: "bnia" }), want, now)).toBe(false)
    expect(isReusableInvoice(va(), { ...want, rail: "qris", va_bank: null }, now)).toBe(false)
  })
  it("not when paid, expired or about to expire", () => {
    expect(isReusableInvoice(va({ status: "paid" }), want, now)).toBe(false)
    expect(isReusableInvoice(va({ status: "expired" }), want, now)).toBe(false)
    expect(isReusableInvoice(va({ expires_at: iso(REUSE_MIN_REMAINING_MS - 1) }), want, now)).toBe(false)
    expect(isReusableInvoice(va({ expires_at: null }), want, now)).toBe(false)
  })
  it("QRIS only while its QR is issued and recent", () => {
    const q = (over: Partial<DoitPayment>) => va({ id: "pay_q", rail: "qris", va_bank: null, qr_content: "000201", ...over })
    const wantQ = { collectionId: "pay_col_1", amount: 170000, rail: "qris" }
    expect(isReusableInvoice(q({}), wantQ, now)).toBe(true)
    expect(isReusableInvoice(q({ qr_content: null }), wantQ, now)).toBe(false)
    expect(isReusableInvoice(q({ rail: null, qr_content: null }), wantQ, now)).toBe(false)
    expect(isReusableInvoice(q({ created_at: iso(-REUSE_QRIS_MAX_AGE_MS) }), wantQ, now)).toBe(false)
  })
})
