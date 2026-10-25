import { PaymentActions } from "@medusajs/framework/utils"
import type { DoitPayment, DoitWebhookEvent } from "../types"
import { decideWebhookAction, type SessionState } from "../webhook"

function payment(overrides: Partial<DoitPayment> = {}): DoitPayment {
  return {
    id: "pay_1",
    status: "paid",
    amount: 150000,
    total_amount: 154000,
    fee_payer: "customer",
    rail: "va",
    reference: "payses_1",
    flags: [],
    ...overrides,
  }
}

function event(p: Partial<DoitPayment> = {}, type = "payment.paid"): DoitWebhookEvent {
  return { id: "evt_1", type, data: payment(p) }
}

function state(overrides: {
  session?: Partial<NonNullable<SessionState["session"]>> | null
  payment?: Partial<NonNullable<SessionState["payment"]>> | null
} = {}): SessionState {
  return {
    session:
      overrides.session === null
        ? null
        : { id: "payses_1", status: "pending", amount: 150000, deleted: false, doitPaymentId: "pay_1", ...overrides.session },
    payment:
      overrides.payment === undefined || overrides.payment === null
        ? null
        : { id: "pay_medusa", captured: false, canceled: false, ...overrides.payment },
  }
}

describe("decideWebhookAction", () => {
  it("captures a normal payment.paid with the invoice amount, not total_amount", () => {
    expect(decideWebhookAction(event(), state())).toEqual({
      action: PaymentActions.SUCCESSFUL,
      sessionId: "payses_1",
      amount: 150000,
      attention: undefined,
    })
  })

  it("captures when the Medusa state is unknown (lookup failed)", () => {
    expect(decideWebhookAction(event(), null).action).toBe(PaymentActions.SUCCESSFUL)
  })

  it("trusts data.status over the event type", () => {
    expect(decideWebhookAction(event({ status: "paid" }, "payment.expired"), state()).action).toBe(
      PaymentActions.SUCCESSFUL
    )
    expect(decideWebhookAction(event({ status: "expired" }, "payment.paid"), state()).action).toBe(
      PaymentActions.CANCELED
    )
  })

  it.each([
    ["pending", PaymentActions.PENDING],
    ["expired", PaymentActions.CANCELED],
    ["failed", PaymentActions.FAILED],
    ["refunded", PaymentActions.NOT_SUPPORTED],
  ])("maps status %s → %s", (status, action) => {
    expect(decideWebhookAction(event({ status: status as DoitPayment["status"] }), state()).action).toBe(action)
  })

  it.each(["webhook.test", "invoice.created", "refund.succeeded", "refund.failed", "payment.proof_uploaded", "x.unknown"])(
    "%s is not_supported",
    (type) => {
      expect(decideWebhookAction(event({}, type), state())).toEqual({ action: PaymentActions.NOT_SUPPORTED })
    }
  )

  it("ignores payments that do not reference a Medusa session", () => {
    expect(decideWebhookAction(event({ reference: "INV/001" }), state())).toEqual({
      action: PaymentActions.NOT_SUPPORTED,
    })
    expect(decideWebhookAction({ id: "evt", type: "payment.paid" }, state())).toEqual({
      action: PaymentActions.NOT_SUPPORTED,
    })
  })

  describe("bayar_telat", () => {
    const late = { flags: ["bayar_telat"] }

    it("accept (default): captures while the session is open", () => {
      expect(decideWebhookAction(event(late), state({ session: { status: "canceled" } })).action).toBe(
        PaymentActions.SUCCESSFUL
      )
    })

    it("flag: leaves Medusa untouched and asks for a decision", () => {
      const d = decideWebhookAction(event(late), state(), { latePaymentPolicy: "flag" })
      expect(d.action).toBe(PaymentActions.NOT_SUPPORTED)
      expect(d.attention?.code).toBe("late_payment_flagged")
    })

    it("canceled Medusa payment: never captures, asks fulfil or refund", () => {
      const d = decideWebhookAction(event(late), state({ payment: { canceled: true } }))
      expect(d.action).toBe(PaymentActions.NOT_SUPPORTED)
      expect(d.attention?.code).toBe("late_payment_canceled")
      expect(d.attention?.message).toMatch(/penuhi pesanan atau refund/)
    })

    it("session gone: asks for a manual decision", () => {
      for (const s of [state({ session: null }), state({ session: { deleted: true } })]) {
        const d = decideWebhookAction(event(late), s)
        expect(d.action).toBe(PaymentActions.NOT_SUPPORTED)
        expect(d.attention?.code).toBe("paid_without_session")
      }
    })
  })

  describe("bayar_ganda", () => {
    const double = { flags: ["bayar_ganda"] }

    it("first delivery: captures once and flags the excess for a manual refund", () => {
      const d = decideWebhookAction(event(double), state())
      expect(d.action).toBe(PaymentActions.SUCCESSFUL)
      expect(d.amount).toBe(150000)
      expect(d.attention?.code).toBe("overpaid")
    })

    it("already captured: does not capture again, flags the excess", () => {
      const d = decideWebhookAction(event(double), state({ payment: { captured: true } }))
      expect(d.action).toBe(PaymentActions.NOT_SUPPORTED)
      expect(d.attention?.code).toBe("overpaid")
    })
  })

  it("duplicate payment.paid after capture is a silent no-op", () => {
    expect(decideWebhookAction(event(), state({ payment: { captured: true } }))).toEqual({
      action: PaymentActions.NOT_SUPPORTED,
      sessionId: "payses_1",
      amount: 150000,
    })
  })

  it("an old invoice of the same session is flagged, not captured", () => {
    const d = decideWebhookAction(event({ id: "pay_old" }), state())
    expect(d.action).toBe(PaymentActions.NOT_SUPPORTED)
    expect(d.attention?.code).toBe("superseded_invoice_paid")
  })

  it("an amount that differs from the session is flagged", () => {
    const d = decideWebhookAction(event(), state({ session: { amount: 200000 } }))
    expect(d.action).toBe(PaymentActions.NOT_SUPPORTED)
    expect(d.attention?.code).toBe("amount_mismatch")
  })
})
