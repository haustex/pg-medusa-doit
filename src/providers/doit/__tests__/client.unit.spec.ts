import { DoitApiError, DoitClient, resetDoitRateLimiter } from "../client"

type Call = { url: string; init: RequestInit }

function jsonResponse(status: number, body: unknown, headers: Record<string, string> = {}) {
  return new Response(body === undefined ? "" : JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", ...headers },
  })
}

function fakeFetch(responses: (Response | Error)[]) {
  const calls: Call[] = []
  const fn = jest.fn(async (url: URL | string, init?: RequestInit) => {
    calls.push({ url: String(url), init: init ?? {} })
    const next = responses.shift()
    if (!next) {
      throw new Error("no more responses")
    }
    if (next instanceof Error) {
      throw next
    }
    return next
  })
  return { fn: fn as unknown as typeof fetch, calls }
}

const PAYMENT = { id: "pay_1", status: "pending", amount: 150000, reference: "payses_1" }

describe("DoitClient", () => {
  beforeEach(() => resetDoitRateLimiter())

  function client(responses: (Response | Error)[], extra: Partial<ConstructorParameters<typeof DoitClient>[0]> = {}) {
    const f = fakeFetch(responses)
    const sleeps: number[] = []
    const c = new DoitClient({
      apiKey: `pb_test_FAKE_${Math.random()}`,
      fetch: f.fn,
      sleep: async (ms) => {
        sleeps.push(ms)
      },
      ...extra,
    })
    return { c, calls: f.calls, sleeps }
  }

  it("sends Bearer auth, JSON body and Idempotency-Key on POST", async () => {
    const { c, calls } = client([jsonResponse(201, PAYMENT)])
    const res = await c.createPayment({ amount: 150000, reference: "payses_1", rail: "qris" }, "idem-1")
    expect(res).toEqual(PAYMENT)
    expect(calls[0].url).toBe("https://pay.doit.id/v1/payments")
    const headers = calls[0].init.headers as Record<string, string>
    expect(headers.Authorization).toMatch(/^Bearer pb_test_FAKE_/)
    expect(headers["Idempotency-Key"]).toBe("idem-1")
    expect(headers["Content-Type"]).toBe("application/json")
    expect(JSON.parse(calls[0].init.body as string)).toEqual({ amount: 150000, reference: "payses_1", rail: "qris" })
  })

  it("refuses a POST without Idempotency-Key before calling the API", async () => {
    const { c, calls } = client([])
    await expect(c.createRefund("pay_1", {}, "")).rejects.toMatchObject({ code: "missing_idempotency_key" })
    expect(calls).toHaveLength(0)
  })

  it("builds GET query strings and encodes ids", async () => {
    const { c, calls } = client([jsonResponse(200, { data: [] }), jsonResponse(200, PAYMENT)])
    await c.listPayments({ status: "paid", limit: 100, before: undefined })
    await c.getPayment("pay_a/b")
    expect(calls[0].url).toBe("https://pay.doit.id/v1/payments?status=paid&limit=100")
    expect(calls[1].url).toBe("https://pay.doit.id/v1/payments/pay_a%2Fb")
    expect((calls[0].init.headers as Record<string, string>)["Idempotency-Key"]).toBeUndefined()
  })

  it("maps the error envelope", async () => {
    const { c } = client([
      jsonResponse(400, { error: { code: "invalid_request", message: "amount", doc_url: "https://doit.id/docs/#e" } }),
    ])
    const err = (await c.getPayment("pay_1").catch((e) => e)) as DoitApiError
    expect(err).toBeInstanceOf(DoitApiError)
    expect(err).toMatchObject({ status: 400, code: "invalid_request", message: "amount", docUrl: "https://doit.id/docs/#e" })
    expect(err.retryable).toBe(false)
  })

  it("retries 429 after Retry-After with the same Idempotency-Key", async () => {
    const { c, calls, sleeps } = client([
      jsonResponse(429, { error: { code: "rate_limited", message: "slow down" } }, { "Retry-After": "2" }),
      jsonResponse(200, PAYMENT),
    ])
    await expect(c.createPayment({ amount: 1, reference: "r", rail: "any" }, "idem-x")).resolves.toEqual(PAYMENT)
    expect(sleeps).toContain(2000)
    expect(calls).toHaveLength(2)
    expect(calls.map((x) => (x.init.headers as Record<string, string>)["Idempotency-Key"])).toEqual(["idem-x", "idem-x"])
    expect(calls[0].init.body).toBe(calls[1].init.body)
  })

  it("retries 503 and network errors, then gives up", async () => {
    const { c, calls } = client(
      [
        jsonResponse(503, { error: { code: "service_unavailable", message: "x" } }, { "Retry-After": "1" }),
        new TypeError("fetch failed"),
        jsonResponse(500, { error: { code: "internal_error", message: "x" } }),
      ],
      { maxRetries: 2 }
    )
    const err = (await c.getPayment("pay_1").catch((e) => e)) as DoitApiError
    expect(err.code).toBe("internal_error")
    expect(calls).toHaveLength(3)
  })

  it("does not wait longer than maxRetryWaitMs", async () => {
    const { c, calls, sleeps } = client(
      [jsonResponse(429, { error: { code: "rate_limited", message: "x" } }, { "Retry-After": "60" })],
      { maxRetryWaitMs: 10_000 }
    )
    await expect(c.getPayment("pay_1")).rejects.toMatchObject({ code: "rate_limited", retryAfter: 60 })
    expect(calls).toHaveLength(1)
    expect(sleeps).toEqual([])
  })

  it("does not retry provider_refund_failed (502)", async () => {
    const { c, calls } = client([
      jsonResponse(502, { error: { code: "provider_refund_failed", message: "bank menolak" } }),
    ])
    await expect(c.createRefund("pay_1", { amount: 1 }, "rf-1")).rejects.toMatchObject({
      code: "provider_refund_failed",
      message: "bank menolak",
    })
    expect(calls).toHaveLength(1)
  })

  it("reports timeouts as retryable transport errors", async () => {
    const timeout = Object.assign(new Error("t"), { name: "TimeoutError" })
    const { c } = client([timeout], { maxRetries: 0 })
    const err = (await c.getPayment("pay_1").catch((e) => e)) as DoitApiError
    expect(err).toMatchObject({ status: 0, code: "timeout" })
    expect(err.retryable).toBe(true)
  })

  it("throttles to 120 requests per minute per key", async () => {
    let now = 0
    const responses = Array.from({ length: 122 }, () => jsonResponse(200, PAYMENT))
    const { c, sleeps } = client(responses, { apiKey: "pb_test_FAKE_bucket", now: () => now })
    for (let i = 0; i < 120; i++) {
      await c.getPayment("pay_1")
    }
    expect(sleeps).toEqual([])
    await c.getPayment("pay_1")
    expect(sleeps).toEqual([500])
    now += 60_000
    await c.getPayment("pay_1")
    expect(sleeps).toEqual([500])
  })

  it("respects a custom base URL", async () => {
    const { c, calls } = client([jsonResponse(200, { data: [] })], { baseUrl: "http://127.0.0.1:9399/" })
    await c.listMethods(150000)
    expect(calls[0].url).toBe("http://127.0.0.1:9399/v1/methods?amount=150000")
  })
})
