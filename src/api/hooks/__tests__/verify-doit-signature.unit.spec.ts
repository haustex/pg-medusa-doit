import { EventEmitter } from "node:events"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import { invalidateDoitCredentialsCache } from "../../../lib/credentials"
import { computeSignature } from "../../../providers/doit/signature"
import { verifyDoitSignature } from "../verify-doit-signature"

// Stand-in for the doit_event table: the unique event_id is the dedupe.
const claimed = new Set<string>()
const claimRun = jest.fn(async ({ input }: { input: { event_id: string } }) => {
  const duplicate = claimed.has(input.event_id)
  claimed.add(input.event_id)
  return { result: { duplicate, id: "doitevt_1" } }
})
jest.mock("../../../workflows/claim-doit-event", () => ({
  claimDoitEventWorkflow: () => ({ run: claimRun }),
}))

const SECRET = "whsec_FAKE_middleware_spec_1234"

const configModule = {
  modules: {
    payment: {
      resolve: "@medusajs/medusa/payment",
      options: {
        providers: [{ resolve: "medusa-payment-doit/providers/doit", id: "doit", options: { webhook_secret: SECRET, api_key: "pb_test_FAKE_x" } }],
      },
    },
  },
}

function makeReq({
  provider = "doit_doit",
  body = { id: "evt_1", type: "payment.paid", data: { id: "pay_1" } } as Record<string, unknown>,
  secret = SECRET,
  t = Math.floor(Date.now() / 1000),
  header,
  rawBody,
}: {
  provider?: string
  body?: Record<string, unknown>
  secret?: string
  t?: number
  header?: string | null
  rawBody?: unknown
} = {}) {
  const raw = JSON.stringify(body)
  const logger = { warn: jest.fn(), info: jest.fn() }
  const services: Record<string, unknown> = {
    [ContainerRegistrationKeys.CONFIG_MODULE]: configModule,
    [ContainerRegistrationKeys.LOGGER]: logger,
    [ContainerRegistrationKeys.PG_CONNECTION]: undefined,
  }
  const sig = header === undefined ? `t=${t},v1=${computeSignature(secret, String(t), raw)}` : header
  return {
    req: {
      params: { provider },
      body: JSON.parse(raw),
      rawBody: rawBody === undefined ? Buffer.from(raw) : rawBody,
      headers: sig === null ? {} : { "paybridge-signature": sig },
      scope: { resolve: (k: string) => services[k] },
    },
    logger,
  }
}

function makeRes() {
  const res = Object.assign(new EventEmitter(), {
    statusCode: 200,
    body: undefined as unknown,
    status(code: number) {
      res.statusCode = code
      return res
    },
    json(b: unknown) {
      res.body = b
      res.emit("finish")
      return res
    },
  })
  return res
}

async function run(reqOpts: Parameters<typeof makeReq>[0] = {}) {
  const { req, logger } = makeReq(reqOpts)
  const res = makeRes()
  const next = jest.fn()
  await verifyDoitSignature(req as never, res as never, next)
  return { res, next, logger }
}

describe("verifyDoitSignature middleware", () => {
  beforeEach(() => {
    invalidateDoitCredentialsCache()
    claimed.clear()
    claimRun.mockClear()
    delete process.env.DOIT_WEBHOOK_SECRET
    delete process.env.DOIT_API_KEY
  })

  it("passes a valid signature through to Medusa's route", async () => {
    const { res, next } = await run()
    expect(next).toHaveBeenCalledWith()
    expect(res.body).toBeUndefined()
  })

  it("leaves other providers alone, even unsigned", async () => {
    const { next, res } = await run({ provider: "stripe_stripe", header: null })
    expect(next).toHaveBeenCalled()
    expect(res.statusCode).toBe(200)
  })

  it.each([
    ["wrong secret", { secret: "nope" }, "mismatch"],
    ["missing header", { header: null }, "missing_header"],
    ["malformed header", { header: "v1=abc" }, "malformed_header"],
    ["timestamp 5 min + 1 s old", { t: Math.floor(Date.now() / 1000) - 301 }, "timestamp_out_of_range"],
    ["timestamp 10 min in the future", { t: Math.floor(Date.now() / 1000) + 600 }, "timestamp_out_of_range"],
    ["no raw body", { rawBody: null }, "missing_body"],
  ])("answers 401 for %s", async (_label, opts, reason) => {
    const { res, next, logger } = await run(opts as never)
    expect(next).not.toHaveBeenCalled()
    expect(res.statusCode).toBe(401)
    expect(res.body).toEqual({ error: { code: "invalid_signature", message: `Signature verification failed: ${reason}` } })
    expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining(reason))
  })

  it("answers 401 when no signing secret is configured", async () => {
    const original = configModule.modules.payment.options.providers[0].options
    configModule.modules.payment.options.providers[0].options = { api_key: "pb_test_FAKE_x" } as never
    try {
      const { res, next } = await run()
      expect(next).not.toHaveBeenCalled()
      expect(res.statusCode).toBe(401)
      expect((res.body as { error: { code: string } }).error.code).toBe("webhook_secret_not_configured")
    } finally {
      configModule.modules.payment.options.providers[0].options = original
    }
  })

  it("claims the event in the database with its payment id", async () => {
    await run({ body: { id: "evt_claim", type: "payment.paid", data: { id: "pay_9", status: "paid" } } })
    expect(claimRun).toHaveBeenCalledWith({
      input: {
        event_id: "evt_claim",
        type: "payment.paid",
        doit_payment_id: "pay_9",
        payload: { id: "evt_claim", type: "payment.paid", data: { id: "pay_9", status: "paid" } },
      },
    })
  })

  it("answers a redelivered event 200 without queuing it again", async () => {
    const first = await run()
    expect(first.next).toHaveBeenCalled()

    const second = await run()
    expect(second.next).not.toHaveBeenCalled()
    expect(second.res.statusCode).toBe(200)
    expect(second.res.body).toEqual({ received: true, duplicate: true })
  })

  it("does not claim anything for a rejected signature", async () => {
    await run({ secret: "nope" })
    expect(claimRun).not.toHaveBeenCalled()
  })
})
