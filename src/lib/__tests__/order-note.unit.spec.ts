import { toOrderNote } from "../order-note"

describe("toOrderNote", () => {
  it("VA with the fee paid by the shopper", () => {
    expect(
      toOrderNote({ id: "pay_1", rail: "va", va_bank: "bmri", amount: 170000, fee_amount: 4000, fee_payer: "customer", total_amount: 174000, paid_at: "2026-10-25T08:35:17Z", environment: "test", metadata: { x: 1 } })
    ).toEqual({
      payment_id: "pay_1", rail: "va", va_bank: "bmri", amount: 170000, fee_amount: 4000, fee_payer: "customer",
      total_amount: 174000, customer_fee: 4000, merchant_fee: 0, paid_at: "2026-10-25T08:35:17Z", environment: "test",
    })
  })
  it("QRIS with the fee paid by the store; rail falls back to the requested one", () => {
    const note = toOrderNote({ id: "pay_2", rail: null, requested_rail: "qris", amount: 150000, fee_amount: 1050, fee_payer: "merchant", total_amount: 150000 })
    expect(note).toMatchObject({ rail: "qris", customer_fee: 0, merchant_fee: 1050, total_amount: 150000 })
  })
  it("null for anything that is not a doit payment", () => {
    expect(toOrderNote({ id: "pi_123" })).toBeNull()
    expect(toOrderNote(undefined)).toBeNull()
  })
})
