import type { DoitPayment } from "../../providers/doit/types"
import { mergeStatus } from "../../workflows/steps/doit-ledger"
import {
  attention,
  classifyRedelivery,
  IN_FLIGHT_MS,
  netAmount,
  parseRefundEvent,
  refundMismatch,
  refundsFromPaymentData,
  toLedgerPayment,
} from "../ledger"

const PAYMENT: DoitPayment = {
  id: "pay_1",
  status: "paid",
  amount: 150000,
  rail: "va",
  va_bank: "bmri",
  reference: "payses_01ABC",
  fee_amount: 4000,
  fee_payer: "customer",
  total_amount: 154000,
  environment: "test",
  flags: ["bayar_telat"],
  paid_at: "2026-10-25T05:55:11.655Z",
  expires_at: "2026-10-26T05:49:58.083Z",
  created_at: "2026-10-25T05:49:58.083Z",
}

describe("toLedgerPayment", () => {
  it("maps gross / fee / net and dates; session from the reference", () => {
    const row = toLedgerPayment(PAYMENT)
    expect(row).toMatchObject({
      doit_id: "pay_1",
      session_id: "payses_01ABC",
      status: "paid",
      amount: 150000,
      fee_amount: 4000,
      net_amount: 150000,
      total_amount: 154000,
      fee_payer: "customer",
      rail: "va",
      va_bank: "bmri",
      environment: "test",
      flags: ["bayar_telat"],
    })
    expect(row.paid_at?.toISOString()).toBe("2026-10-25T05:55:11.655Z")
    expect(row.doit_created_at?.toISOString()).toBe("2026-10-25T05:49:58.083Z")
    expect(row.raw).toBe(PAYMENT)
  })

  it("leaves session_id empty for portal / foreign references and tolerates nulls", () => {
    const row = toLedgerPayment({ ...PAYMENT, reference: "INV/001", fee_amount: null, flags: null, paid_at: null })
    expect(row.session_id).toBeNull()
    expect(row.fee_amount).toBe(0)
    expect(row.flags).toEqual([])
    expect(row.paid_at).toBeNull()
  })
})

describe("netAmount", () => {
  it("subtracts the fee only when the merchant pays it", () => {
    expect(netAmount(150000, 1050, "merchant")).toBe(148950)
    expect(netAmount(150000, 4000, "customer")).toBe(150000)
    expect(netAmount(150000, 0, null)).toBe(150000)
  })
})

describe("mergeStatus", () => {
  it("never moves a payment backwards", () => {
    expect(mergeStatus(undefined, "pending")).toBe("pending")
    expect(mergeStatus("pending", "paid")).toBe("paid")
    expect(mergeStatus("expired", "paid")).toBe("paid")
    expect(mergeStatus("paid", "expired")).toBe("paid")
    expect(mergeStatus("paid", "pending")).toBe("paid")
    expect(mergeStatus("paid", "refunded")).toBe("refunded")
    expect(mergeStatus("pending", "expired")).toBe("expired")
  })
})

describe("parseRefundEvent", () => {
  it("reads a refund object", () => {
    expect(
      parseRefundEvent({
        id: "evt_r",
        type: "refund.succeeded",
        data: { id: "rf_1", payment_id: "pay_1", amount: 50000, status: "succeeded", reason: null } as never,
      })
    ).toEqual({
      doit_refund_id: "rf_1",
      doit_payment_id: "pay_1",
      medusa_refund_id: null,
      amount: 50000,
      status: "succeeded",
      reason: null,
      source: "webhook",
      webhook_event_id: "evt_r",
      raw: { id: "rf_1", payment_id: "pay_1", amount: 50000, status: "succeeded", reason: null },
    })
  })

  it("reads a payment carrying a nested refund, and refund.failed", () => {
    const parsed = parseRefundEvent({
      id: "evt_f",
      type: "refund.failed",
      data: { ...PAYMENT, refund: { id: "rf_2", amount: 1000, failure_reason: "rekening ditutup" } } as never,
    })
    expect(parsed).toMatchObject({
      doit_refund_id: "rf_2",
      doit_payment_id: "pay_1",
      amount: 1000,
      status: "failed",
      reason: "rekening ditutup",
    })
  })

  it("returns null for other events or unusable payloads", () => {
    expect(parseRefundEvent({ id: "e", type: "payment.paid", data: PAYMENT })).toBeNull()
    expect(parseRefundEvent({ id: "e", type: "refund.succeeded", data: { amount: 1 } as never })).toBeNull()
    expect(parseRefundEvent({ id: "e", type: "refund.succeeded", data: { id: "rf_1", payment_id: "pay_1" } as never })).toBeNull()
  })
})

describe("refundsFromPaymentData", () => {
  it("turns the provider's stored refund responses into ledger rows", () => {
    expect(
      refundsFromPaymentData({
        id: "pay_1",
        refunds: [
          {
            idempotency_key: "ref_01",
            amount: 50000,
            response: { id: "rf_1", amount: 50000, status: "succeeded", reason: "Refund dari Medusa", payment_id: "pay_1" },
          },
          { idempotency_key: "ref_02", amount: 1000, response: { id: "rf_2", status: "processing" } },
        ],
      })
    ).toEqual([
      expect.objectContaining({ doit_refund_id: "rf_1", medusa_refund_id: "ref_01", amount: 50000, status: "succeeded", source: "api" }),
      expect.objectContaining({ doit_refund_id: "rf_2", medusa_refund_id: "ref_02", amount: 1000, status: "pending" }),
    ])
  })

  it("is empty without a doit.id payment id or refunds", () => {
    expect(refundsFromPaymentData({ refunds: [{ amount: 1 }] })).toEqual([])
    expect(refundsFromPaymentData({ id: "pay_1" })).toEqual([])
    expect(refundsFromPaymentData(undefined)).toEqual([])
  })
})

describe("classifyRedelivery", () => {
  const now = Date.parse("2026-10-25T10:00:00Z")
  const at = (msAgo: number) => new Date(now - msAgo)

  it("drops events already processed or ignored", () => {
    expect(classifyRedelivery({ status: "processed", attempts: 1, received_at: at(10) }, now)).toBe("duplicate")
    expect(classifyRedelivery({ status: "ignored", attempts: 1, received_at: at(10) }, now)).toBe("duplicate")
  })

  it("drops events in flight or being retried by the event bus", () => {
    expect(classifyRedelivery({ status: "received", attempts: 0, received_at: at(1000) }, now)).toBe("duplicate")
    expect(classifyRedelivery({ status: "received", attempts: 2, received_at: at(IN_FLIGHT_MS * 3) }, now)).toBe("duplicate")
  })

  it("re-queues events that gave up, or were claimed but never queued", () => {
    expect(classifyRedelivery({ status: "failed", attempts: 3, received_at: at(1000) }, now)).toBe("requeue")
    expect(classifyRedelivery({ status: "received", attempts: 0, received_at: at(IN_FLIGHT_MS + 1) }, now)).toBe("requeue")
  })
})

describe("refundMismatch", () => {
  it("is null when doit.id and Medusa agree", () => {
    expect(refundMismatch({ doitPaymentId: "pay_1", amount: 150000, doitRefunded: 50000, medusaRefunded: 50000 })).toBeNull()
    expect(refundMismatch({ doitPaymentId: "pay_1", amount: 150000, doitRefunded: 0, medusaRefunded: null })).toBeNull()
  })

  it("flags a refund made outside Medusa", () => {
    const item = refundMismatch({ doitPaymentId: "pay_1", amount: 150000, doitRefunded: 70000, medusaRefunded: 50000 })
    expect(item).toMatchObject({ code: "refund_mismatch", amount: 20000, doit_payment_id: "pay_1" })
    expect(item?.dedupe_key).toBe("refund_mismatch:pay_1:70000:50000")
  })

  it("flags refunds above the payment amount (sandbox accepted those)", () => {
    const item = refundMismatch({ doitPaymentId: "pay_1", amount: 150000, doitRefunded: 250001, medusaRefunded: 250001 })
    expect(item?.message).toMatch(/melebihi nominal/)
  })
})

describe("attention", () => {
  it("builds the dedupe key from code and key", () => {
    expect(attention("overpaid", "pay_1", "x")).toEqual({ code: "overpaid", dedupe_key: "overpaid:pay_1", message: "x" })
  })
})
