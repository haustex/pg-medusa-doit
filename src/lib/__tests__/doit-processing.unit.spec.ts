import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils"
import { computeSignature } from "../../providers/doit/signature"
import { invalidateDoitCredentialsCache } from "../credentials"

const ledgerRuns: Record<string, any>[] = []
const recordRun = jest.fn(async ({ input }: { input: Record<string, any> }) => {
  ledgerRuns.push(input)
  const totals = (input.refunds ?? []).map((r: any) => ({
    doit_id: r.doit_payment_id,
    amount: 150000,
    refunded_amount: r.status === "succeeded" ? r.amount : 0,
    session_id: "payses_1",
    order_id: "order_1",
  }))
  return { result: { payments: [], totals, attentions: { created: [] } } }
})
jest.mock("../../workflows/record-doit-ledger", () => ({
  recordDoitLedgerWorkflow: () => ({ run: recordRun }),
}))

const processRun = jest.fn(async () => ({ result: undefined }))
jest.mock("@medusajs/medusa/core-flows", () => ({
  processPaymentWorkflow: () => ({ run: processRun }),
}))

let sessionContext: any = null
jest.mock("../session-state", () => ({
  loadSessionContext: jest.fn(async () => sessionContext),
}))

// eslint-disable-next-line import/first
import { handleDoitWebhook, handleMedusaRefund } from "../doit-processing"

const SECRET = "whsec_FAKE_processing_spec_00"

function context({
  captured = false,
  canceled = false,
  hasPayment = false,
  doitPaymentId = "pay_1",
  orderId = null as string | null,
  medusaRefunded = null as number | null,
} = {}) {
  return {
    state: {
      session: { id: "payses_1", status: "pending", amount: 150000, deleted: false, doitPaymentId },
      payment: hasPayment || captured || canceled ? { id: "pay_m", captured, canceled } : null,
    },
    cartId: "cart_1",
    orderId,
    medusaRefunded,
    medusaPaymentId: hasPayment ? "pay_m" : null,
  }
}

function makeContainer({
  existingEvent = null as Record<string, any> | null,
  retries,
  queryPayment = null as Record<string, any> | null,
}: { existingEvent?: Record<string, any> | null; retries?: number; queryPayment?: Record<string, any> | null } = {}) {
  const logger = { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() }
  const services: Record<string, unknown> = {
    [ContainerRegistrationKeys.LOGGER]: logger,
    [ContainerRegistrationKeys.PG_CONNECTION]: undefined,
    [ContainerRegistrationKeys.CONFIG_MODULE]: {
      modules: {
        [Modules.PAYMENT]: {
          resolve: "@medusajs/medusa/payment",
          options: {
            ...(retries ? { webhook_retries: retries } : {}),
            providers: [{ resolve: "medusa-payment-doit/providers/doit", id: "doit", options: { webhook_secret: SECRET, api_key: "pb_test_FAKE_p" } }],
          },
        },
      },
    },
    doitLedger: { listDoitEvents: jest.fn(async () => (existingEvent ? [existingEvent] : [])) },
    [ContainerRegistrationKeys.QUERY]: {
      graph: jest.fn(async () => ({ data: queryPayment ? [queryPayment] : [] })),
    },
  }
  return { container: { resolve: (k: string) => services[k] } as never, logger }
}

function signed(event: Record<string, unknown>, secret = SECRET) {
  const raw = JSON.stringify(event)
  const t = Math.floor(Date.now() / 1000) - 3600 // the worker does not check t
  return {
    provider: "doit_doit",
    payload: {
      data: JSON.parse(raw),
      rawData: JSON.parse(JSON.stringify(Buffer.from(raw))), // as it arrives through Redis
      headers: { "paybridge-signature": `t=${t},v1=${computeSignature(secret, String(t), raw)}` },
    },
  }
}

const paid = (over: Record<string, unknown> = {}) => ({
  id: "evt_1",
  type: "payment.paid",
  data: { id: "pay_1", status: "paid", amount: 150000, reference: "payses_1", flags: [], ...over },
})

beforeEach(() => {
  invalidateDoitCredentialsCache()
  ledgerRuns.length = 0
  recordRun.mockClear()
  processRun.mockReset()
  processRun.mockResolvedValue({ result: undefined })
  sessionContext = context()
  delete process.env.DOIT_WEBHOOK_SECRET
  delete process.env.DOIT_API_KEY
})

describe("handleDoitWebhook", () => {
  it("ignores non-doit providers and bad signatures", async () => {
    const { container, logger } = makeContainer()
    await handleDoitWebhook(container, { ...signed(paid()), provider: "stripe_stripe" })
    await handleDoitWebhook(container, signed(paid(), "wrong"))
    expect(recordRun).not.toHaveBeenCalled()
    expect(processRun).not.toHaveBeenCalled()
    expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining("mismatch"))
  })

  it("payment.paid: writes the ledger, captures once, marks the event processed", async () => {
    const { container } = makeContainer()
    await handleDoitWebhook(container, signed(paid()))
    expect(processRun).toHaveBeenCalledWith({
      input: { action: "captured", data: { session_id: "payses_1", amount: 150000 } },
    })
    expect(ledgerRuns[0].payments[0]).toMatchObject({ doit_id: "pay_1", status: "paid" })
    const last = ledgerRuns[ledgerRuns.length - 1]
    expect(last.payments[0].reconciled_at).toBeInstanceOf(Date)
    expect(last.event).toMatchObject({ event_id: "evt_1", status: "processed", attempts: 1, doit_payment_id: "pay_1" })
    expect(last.resolve_attentions).toEqual([{ dedupe_key: "webhook_failed:evt_1", note: expect.any(String) }])
  })

  it("skips events the ledger already processed", async () => {
    const { container } = makeContainer({ existingEvent: { status: "processed", attempts: 1 } })
    await handleDoitWebhook(container, signed(paid()))
    expect(processRun).not.toHaveBeenCalled()
    expect(recordRun).not.toHaveBeenCalled()
  })

  it("bayar_ganda after capture: no second capture, one overpaid item", async () => {
    sessionContext = context({ captured: true, orderId: "order_1" })
    const { container } = makeContainer()
    await handleDoitWebhook(container, signed(paid({ flags: ["bayar_ganda"] })))
    expect(processRun).not.toHaveBeenCalled()
    const last = ledgerRuns[ledgerRuns.length - 1]
    expect(last.attentions).toEqual([
      expect.objectContaining({ code: "overpaid", dedupe_key: "overpaid:pay_1", order_id: "order_1", doit_payment_id: "pay_1" }),
    ])
  })

  it("bayar_telat on a canceled payment: no capture, late_payment_canceled item", async () => {
    sessionContext = context({ canceled: true, orderId: "order_1" })
    const { container } = makeContainer()
    await handleDoitWebhook(container, signed(paid({ flags: ["bayar_telat"] })))
    expect(processRun).not.toHaveBeenCalled()
    const last = ledgerRuns[ledgerRuns.length - 1]
    expect(last.attentions[0]).toMatchObject({ code: "late_payment_canceled", dedupe_key: "late_payment_canceled:pay_1" })
    expect(last.payments[0].reconciled_at).toBeInstanceOf(Date)
  })

  it("payment.expired only updates the ledger", async () => {
    const { container } = makeContainer()
    await handleDoitWebhook(container, signed({ id: "evt_e", type: "payment.expired", data: { ...paid().data, status: "expired" } }))
    expect(processRun).not.toHaveBeenCalled()
    expect(ledgerRuns[0].payments[0].status).toBe("expired")
    expect(ledgerRuns[ledgerRuns.length - 1].event.status).toBe("processed")
  })

  it("webhook.test and unknown events are recorded as ignored", async () => {
    const { container } = makeContainer()
    await handleDoitWebhook(container, signed({ id: "evt_t", type: "webhook.test", data: {} }))
    expect(ledgerRuns).toEqual([{ event: expect.objectContaining({ event_id: "evt_t", status: "ignored" }) }])
  })

  it("refund.succeeded: records the refund and checks totals against Medusa", async () => {
    sessionContext = context({ captured: true, medusaRefunded: 50000 })
    const { container } = makeContainer()
    await handleDoitWebhook(
      container,
      signed({ id: "evt_r", type: "refund.succeeded", data: { id: "rf_1", payment_id: "pay_1", amount: 70000, status: "succeeded" } })
    )
    expect(ledgerRuns[0].refunds[0]).toMatchObject({ doit_refund_id: "rf_1", amount: 70000, status: "succeeded", source: "webhook" })
    expect(ledgerRuns[0].event).toMatchObject({ status: "processed", doit_payment_id: "pay_1" })
    // ledger says 70 000 refunded, Medusa 50 000 → refund_mismatch
    expect(ledgerRuns[1].attentions[0]).toMatchObject({ code: "refund_mismatch", amount: 20000 })
  })

  it("refund.failed raises refund_failed", async () => {
    const { container } = makeContainer()
    await handleDoitWebhook(
      container,
      signed({ id: "evt_rf", type: "refund.failed", data: { id: "rf_9", payment_id: "pay_1", amount: 1000, reason: "ditolak bank" } })
    )
    expect(ledgerRuns[0].attentions[0]).toMatchObject({ code: "refund_failed", dedupe_key: "refund_failed:rf_9" })
    expect(ledgerRuns[0].attentions[0].message).toContain("ditolak bank")
  })

  it("a failing capture is rethrown with the attempt counted", async () => {
    processRun.mockRejectedValue(new Error("Session payses_1 was not authorized with the provider."))
    const { container } = makeContainer()
    await expect(handleDoitWebhook(container, signed(paid()))).rejects.toThrow(/not authorized/)
    const last = ledgerRuns[ledgerRuns.length - 1]
    expect(last.event).toMatchObject({ status: "received", attempts: 1, last_error: expect.stringContaining("not authorized") })
    expect(last.attentions).toEqual([])
  })

  it("the last attempt gives up: event failed + webhook_failed item, not rethrown", async () => {
    processRun.mockRejectedValue(new Error("boom"))
    const { container, logger } = makeContainer({ existingEvent: { status: "received", attempts: 2 } })
    await expect(handleDoitWebhook(container, signed(paid()))).resolves.toBeUndefined()
    const last = ledgerRuns[ledgerRuns.length - 1]
    expect(last.event).toMatchObject({ status: "failed", attempts: 3 })
    expect(last.attentions[0]).toMatchObject({ code: "webhook_failed", dedupe_key: "webhook_failed:evt_1", event_id: "evt_1" })
    expect(logger.error).toHaveBeenCalledWith(expect.stringContaining("PERLU TINDAKAN webhook_failed"))
  })

  it("honours webhook_retries from the payment module options", async () => {
    processRun.mockRejectedValue(new Error("boom"))
    const { container } = makeContainer({ existingEvent: { status: "received", attempts: 2 }, retries: 5 })
    await expect(handleDoitWebhook(container, signed(paid()))).rejects.toThrow("boom")
  })
})

describe("handleMedusaRefund", () => {
  it("copies the stored refund responses of a doit payment into the ledger", async () => {
    sessionContext = context({ captured: true, medusaRefunded: 50000 })
    const { container } = makeContainer({
      queryPayment: {
        id: "pay_m",
        provider_id: "pp_doit_doit",
        data: { id: "pay_1", refunds: [{ idempotency_key: "ref_1", amount: 50000, response: { id: "rf_1", amount: 50000, status: "succeeded" } }] },
      },
    })
    await handleMedusaRefund(container, "pay_m")
    expect(ledgerRuns[0].refunds).toEqual([
      expect.objectContaining({ doit_refund_id: "rf_1", medusa_refund_id: "ref_1", amount: 50000, source: "api" }),
    ])
    expect(ledgerRuns).toHaveLength(1) // totals agree: no refund_mismatch
  })

  it("ignores payments of other providers", async () => {
    const { container } = makeContainer({ queryPayment: { id: "pay_x", provider_id: "pp_stripe_stripe", data: {} } })
    await handleMedusaRefund(container, "pay_x")
    expect(recordRun).not.toHaveBeenCalled()
  })
})
