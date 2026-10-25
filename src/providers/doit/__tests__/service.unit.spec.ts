import { ContainerRegistrationKeys, MedusaError, PaymentActions, PaymentSessionStatus } from "@medusajs/framework/utils"
import { invalidateDoitCredentialsCache } from "../../../lib/credentials"
import { resetDoitRateLimiter } from "../client"
import DoitPaymentProviderService from "../service"
import { computeSignature } from "../signature"

const API_KEY = "pb_test_FAKE_service_spec_0000"
const SECRET = "whsec_FAKE_service_spec_secret"

const PENDING = {
  id: "pay_abc",
  status: "pending",
  amount: 150000,
  rail: "qris",
  reference: "payses_1",
  qr_content: "000201...",
  va_number: null,
  hosted_url: "https://pay.doit.id/p/pay_abc",
  fee_amount: 0,
  fee_payer: "merchant",
  total_amount: 150000,
  environment: "sandbox",
  expires_at: "2026-10-26T00:00:00.000Z",
  paid_at: null,
  flags: [],
}

type Row = Record<string, unknown> | undefined

function fakePg(tables: Record<string, Row>) {
  return (table: string) => {
    const builder = {
      select: () => builder,
      where: () => builder,
      whereNull: () => builder,
      orderBy: () => builder,
      first: async () => tables[table],
    }
    return builder
  }
}

function makeProvider(options: Record<string, unknown> = {}, pg?: unknown) {
  const logger = { warn: jest.fn(), info: jest.fn(), error: jest.fn(), debug: jest.fn() }
  const container: Record<string, unknown> = { logger }
  if (pg) {
    container[ContainerRegistrationKeys.PG_CONNECTION] = pg
  }
  const provider = new DoitPaymentProviderService(container as never, {
    api_key: API_KEY,
    webhook_secret: SECRET,
    max_retries: 0,
    ...options,
  })
  return { provider, logger }
}

let fetchMock: jest.SpyInstance

function respond(status: number, body: unknown) {
  fetchMock.mockResolvedValueOnce(
    new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } })
  )
}

function lastRequest(n = 0) {
  const [url, init] = fetchMock.mock.calls[n]
  return {
    url: String(url),
    method: init.method,
    headers: init.headers as Record<string, string>,
    body: init.body ? JSON.parse(init.body) : undefined,
  }
}

beforeEach(() => {
  invalidateDoitCredentialsCache()
  resetDoitRateLimiter()
  delete process.env.DOIT_API_KEY
  delete process.env.DOIT_WEBHOOK_SECRET
  fetchMock = jest.spyOn(globalThis, "fetch")
})

afterEach(() => fetchMock.mockRestore())

describe("validateOptions", () => {
  it("rejects bad option values", () => {
    expect(() => DoitPaymentProviderService.validateOptions({ late_payment_policy: "refund" })).toThrow()
    expect(() => DoitPaymentProviderService.validateOptions({ max_retries: -1 })).toThrow()
    expect(() => DoitPaymentProviderService.validateOptions({ rail: "card" })).toThrow()
    expect(() => DoitPaymentProviderService.validateOptions({ late_payment_policy: "flag", rail: "va" })).not.toThrow()
  })
})

describe("initiatePayment", () => {
  const input = {
    amount: 150000,
    currency_code: "idr",
    data: { session_id: "payses_1" },
    context: {
      idempotency_key: "payses_1",
      customer: { id: "cus_1", email: "a@b.id", first_name: "Budi", last_name: "Santoso", phone: "0812" },
    },
  }

  it("creates a QRIS payment with reference = session id and an Idempotency-Key", async () => {
    respond(201, PENDING)
    const { provider } = makeProvider({ rail: "qris", expires_in: 3600 })
    const out = await provider.initiatePayment(input)

    const req = lastRequest()
    expect(req.url).toBe("https://pay.doit.id/v1/payments")
    expect(req.method).toBe("POST")
    expect(req.headers.Authorization).toBe(`Bearer ${API_KEY}`)
    expect(req.headers["Idempotency-Key"]).toMatch(/^payses_1-[0-9a-f]{16}$/)
    expect(req.body).toEqual({
      amount: 150000,
      reference: "payses_1",
      rail: "qris",
      expires_in: 3600,
      customer: { name: "Budi Santoso", phone: "0812", email: "a@b.id" },
      metadata: { medusa_payment_session_id: "payses_1" },
    })

    expect(out.id).toBe("pay_abc")
    expect(out.status).toBe(PaymentSessionStatus.PENDING)
    expect(out.data).toMatchObject({
      session_id: "payses_1",
      id: "pay_abc",
      hosted_url: PENDING.hosted_url,
      qr_content: PENDING.qr_content,
      va_number: null,
      expires_at: PENDING.expires_at,
      idempotency_key: req.headers["Idempotency-Key"],
    })
  })

  it("uses the same Idempotency-Key for the same input and a new one when it changes", async () => {
    respond(201, PENDING)
    respond(200, PENDING)
    respond(201, { ...PENDING, id: "pay_new", amount: 175000 })
    const { provider } = makeProvider({ rail: "qris" })
    await provider.initiatePayment(input)
    await provider.initiatePayment(input)
    await provider.initiatePayment({ ...input, amount: 175000 })
    const keys = [0, 1, 2].map((i) => lastRequest(i).headers["Idempotency-Key"])
    expect(keys[0]).toBe(keys[1])
    expect(keys[2]).not.toBe(keys[0])
  })

  it("sends va_bank for VA and transfer rails", async () => {
    respond(201, { ...PENDING, rail: "va", qr_content: null, va_number: "8808123", va_bank: "bmri" })
    respond(201, { ...PENDING, rail: "transfer", qr_content: null, va_bank: "bca", total_amount: 150123 })
    await makeProvider({ rail: "va", va_bank: "bmri" }).provider.initiatePayment(input)
    const out = await makeProvider({ rail: "transfer", va_bank: "bca" }).provider.initiatePayment(input)
    expect(lastRequest(0).body).toMatchObject({ rail: "va", va_bank: "bmri" })
    expect(lastRequest(1).body).toMatchObject({ rail: "transfer", va_bank: "bca" })
    expect(out.data?.total_amount).toBe(150123)
  })

  it("lets the storefront pick the rail and bank, validated", async () => {
    respond(201, PENDING)
    const { provider } = makeProvider({ rail: "qris" })
    await provider.initiatePayment({
      ...input,
      data: { ...input.data, rail: "va", va_bank: "brin", return_url: "https://toko.id/o/1" },
    })
    expect(lastRequest().body).toMatchObject({ rail: "va", va_bank: "brin", return_url: "https://toko.id/o/1" })
    await expect(
      provider.initiatePayment({ ...input, data: { ...input.data, rail: "va", va_bank: "bca" } })
    ).rejects.toThrow(/va_bank/)
  })

  it("rejects non-IDR and fractional amounts without calling doit.id", async () => {
    const { provider } = makeProvider()
    await expect(provider.initiatePayment({ ...input, currency_code: "usd" })).rejects.toThrow(/IDR/)
    await expect(provider.initiatePayment({ ...input, amount: 1500.5 })).rejects.toThrow(/pecahan/)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it("fails clearly without an API key", async () => {
    const { provider } = makeProvider({ api_key: undefined })
    await expect(provider.initiatePayment(input)).rejects.toThrow(/belum dikonfigurasi/)
  })

  it("maps doit.id errors to MedusaError without leaking the key", async () => {
    respond(400, { error: { code: "method_disabled", message: "VA BRI dimatikan" } })
    const { provider } = makeProvider({ rail: "va", va_bank: "brin" })
    const err = await provider.initiatePayment(input).catch((e) => e)
    expect(err).toBeInstanceOf(MedusaError)
    expect(err.type).toBe(MedusaError.Types.INVALID_DATA)
    expect(err.message).toContain("method_disabled")
    expect(err.message).not.toContain(API_KEY)
  })
})

describe("updatePayment", () => {
  const data = { session_id: "payses_1", id: "pay_abc", amount: 150000, status: "pending" }

  it("keeps the invoice when the amount is unchanged", async () => {
    const { provider } = makeProvider()
    const out = await provider.updatePayment({ amount: 150000, currency_code: "idr", data })
    expect(out.data).toBe(data)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it("creates a new invoice when the amount changes and remembers the old one", async () => {
    respond(201, { ...PENDING, id: "pay_new", amount: 175000 })
    const { provider } = makeProvider({ rail: "qris" })
    const out = await provider.updatePayment({ amount: 175000, currency_code: "idr", data })
    expect(lastRequest().body).toMatchObject({ amount: 175000, reference: "payses_1" })
    expect(out.data).toMatchObject({ id: "pay_new", amount: 175000, superseded_ids: ["pay_abc"], session_id: "payses_1" })
  })
})

describe("status", () => {
  it.each([
    ["pending", PaymentSessionStatus.PENDING],
    ["paid", PaymentSessionStatus.CAPTURED],
    ["expired", PaymentSessionStatus.CANCELED],
    ["failed", PaymentSessionStatus.ERROR],
    ["refunded", PaymentSessionStatus.CAPTURED],
  ])("authorizePayment / getPaymentStatus map %s", async (status, expected) => {
    respond(200, { ...PENDING, status })
    respond(200, { ...PENDING, status })
    const { provider } = makeProvider()
    const a = await provider.authorizePayment({ data: { id: "pay_abc", session_id: "payses_1" } })
    const s = await provider.getPaymentStatus({ data: { id: "pay_abc" } })
    expect(a.status).toBe(expected)
    expect(s.status).toBe(expected)
    expect(a.data).toMatchObject({ id: "pay_abc", status, session_id: "payses_1" })
    expect(lastRequest().url).toBe("https://pay.doit.id/v1/payments/pay_abc")
  })

  it("retrievePayment refreshes the data", async () => {
    respond(200, { ...PENDING, status: "paid", paid_at: "2026-10-25T01:00:00.000Z", flags: ["bayar_telat"] })
    const { provider } = makeProvider()
    const out = await provider.retrievePayment({ data: { id: "pay_abc" } })
    expect(out.data).toMatchObject({ status: "paid", flags: ["bayar_telat"] })
  })

  it("requires a doit.id payment id", async () => {
    const { provider } = makeProvider()
    await expect(provider.getPaymentStatus({ data: {} })).rejects.toThrow(/pay_/)
  })

  it("capture is a no-op and cancel stays local", async () => {
    const { provider } = makeProvider()
    expect(await provider.capturePayment({ data: { id: "pay_abc" } })).toEqual({ data: { id: "pay_abc" } })
    expect(await provider.cancelPayment({ data: { id: "pay_abc" } })).toEqual({
      data: { id: "pay_abc", canceled_locally: true },
    })
    expect(fetchMock).not.toHaveBeenCalled()
  })
})

describe("refundPayment", () => {
  it("POSTs a refund with the Medusa refund id as Idempotency-Key", async () => {
    respond(201, { id: "rf_1", status: "pending", amount: 50000 })
    const { provider } = makeProvider()
    const out = await provider.refundPayment({
      amount: 50000,
      data: { id: "pay_abc" },
      context: { idempotency_key: "ref_01" },
    })
    const req = lastRequest()
    expect(req.url).toBe("https://pay.doit.id/v1/payments/pay_abc/refunds")
    expect(req.headers["Idempotency-Key"]).toBe("ref_01")
    expect(req.body).toEqual({ amount: 50000, reason: "Refund dari Medusa" })
    expect(out.data?.refunds).toEqual([
      { idempotency_key: "ref_01", amount: 50000, response: { id: "rf_1", status: "pending", amount: 50000 } },
    ])
  })

  it.each([
    [409, "payment_not_refundable", MedusaError.Types.NOT_ALLOWED],
    [400, "invalid_refund_amount", MedusaError.Types.INVALID_DATA],
    [502, "provider_refund_failed", MedusaError.Types.UNEXPECTED_STATE],
  ])("maps %s %s", async (status, code, type) => {
    respond(status, { error: { code, message: "alasan penyedia" } })
    const { provider } = makeProvider()
    const err = await provider
      .refundPayment({ amount: 1000, data: { id: "pay_abc" }, context: { idempotency_key: "ref_x" } })
      .catch((e) => e)
    expect(err.type).toBe(type)
    expect(err.message).toContain(code)
    expect(err.message).toContain("alasan penyedia")
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it("refuses to refund more than what is left, without calling doit.id", async () => {
    const { provider } = makeProvider()
    const data = {
      id: "pay_abc",
      amount: 150000,
      refunds: [{ idempotency_key: "ref_1", amount: 50000, response: {} }],
    }
    await expect(
      provider.refundPayment({ amount: 100001, data, context: { idempotency_key: "ref_2" } })
    ).rejects.toThrow(/melebihi sisa 100000/)
    expect(fetchMock).not.toHaveBeenCalled()

    respond(201, { id: "rf_2", status: "succeeded", amount: 100000 })
    const out = await provider.refundPayment({ amount: 100000, data, context: { idempotency_key: "ref_2" } })
    expect(out.data?.refunds).toHaveLength(2)
  })

  it("rejects fractional refunds", async () => {
    const { provider } = makeProvider()
    await expect(provider.refundPayment({ amount: 10.5, data: { id: "pay_abc" } })).rejects.toThrow(/pecahan/)
  })
})

describe("getWebhookActionAndData", () => {
  function signed(event: unknown, secret = SECRET, t = Math.floor(Date.now() / 1000)) {
    const raw = JSON.stringify(event)
    return {
      data: JSON.parse(raw),
      rawData: Buffer.from(raw),
      headers: { "paybridge-signature": `t=${t},v1=${computeSignature(secret, String(t), raw)}` },
    }
  }
  const paidEvent = (flags: string[] = [], id = "pay_abc") => ({
    id: "evt_1",
    type: "payment.paid",
    data: { ...PENDING, id, status: "paid", flags },
  })

  it("leaves every event to the plugin subscriber (Medusa's handler must not capture)", async () => {
    const { provider } = makeProvider()
    for (const event of [paidEvent(), paidEvent(["bayar_ganda"]), { id: "evt_t", type: "webhook.test", data: {} }]) {
      expect(await provider.getWebhookActionAndData(signed(event))).toEqual({ action: PaymentActions.NOT_SUPPORTED })
    }
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
