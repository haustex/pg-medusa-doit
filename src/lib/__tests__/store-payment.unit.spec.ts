import {
  canAccessCart,
  pickDoitSession,
  StatusRefresher,
  toPublicPayment,
  toStoreMethods,
  type StoreCart,
} from "../store-payment"
import { RateLimiter } from "../store-rate-limit"
import type { DoitPayment } from "../../providers/doit/types"

const cart = (over: Partial<StoreCart> = {}): StoreCart => ({
  id: "cart_01",
  sales_channel_id: "sc_web",
  customer_id: "cus_guest",
  customer: { has_account: false },
  ...over,
})

describe("canAccessCart", () => {
  it("allows a guest cart from the key's sales channel", () => {
    expect(canAccessCart(cart(), { salesChannelIds: ["sc_web"] })).toBe(true)
  })
  it("rejects a cart of another sales channel", () => {
    expect(canAccessCart(cart(), { salesChannelIds: ["sc_pos"] })).toBe(false)
    expect(canAccessCart(cart(), { salesChannelIds: [] })).toBe(false)
  })
  it("a registered customer's cart needs that customer's session", () => {
    const owned = cart({ customer_id: "cus_budi", customer: { has_account: true } })
    expect(canAccessCart(owned, { salesChannelIds: ["sc_web"] })).toBe(false)
    expect(canAccessCart(owned, { salesChannelIds: ["sc_web"], customerId: "cus_ani" })).toBe(false)
    expect(canAccessCart(owned, { salesChannelIds: ["sc_web"], customerId: "cus_budi" })).toBe(true)
  })
  it("a logged-in customer cannot read someone else's guest cart", () => {
    expect(canAccessCart(cart(), { salesChannelIds: ["sc_web"], customerId: "cus_budi" })).toBe(false)
  })
})

describe("pickDoitSession", () => {
  it("takes the newest non-canceled doit session", () => {
    const c = cart({
      payment_collection: {
        payment_sessions: [
          { id: "payses_old", provider_id: "pp_doit_doit", status: "pending", created_at: "2026-10-25T01:00:00Z" },
          { id: "payses_new", provider_id: "pp_doit_doit", status: "pending", created_at: "2026-10-25T02:00:00Z" },
          { id: "payses_x", provider_id: "pp_doit_doit", status: "canceled", created_at: "2026-10-25T03:00:00Z" },
          { id: "payses_sys", provider_id: "pp_system_default", status: "pending", created_at: "2026-10-25T04:00:00Z" },
        ],
      },
    })
    expect(pickDoitSession(c)?.id).toBe("payses_new")
    expect(pickDoitSession(cart())).toBeNull()
  })
})

describe("toPublicPayment", () => {
  it("keeps display fields only", () => {
    const out = toPublicPayment({
      id: "pay_1",
      status: "pending",
      qr_content: "000201",
      idempotency_key: "secret-ish",
      metadata: { a: 1 },
      flags: ["bayar_ganda"],
      session_id: "payses_1",
    })
    expect(out.id).toBe("pay_1")
    expect(out.qr_content).toBe("000201")
    expect(out.va_number).toBeNull()
    expect(Object.keys(out)).not.toEqual(expect.arrayContaining(["idempotency_key"]))
    expect(JSON.stringify(out)).not.toMatch(/secret-ish|metadata|bayar_ganda|payses_1/)
  })
})

describe("toStoreMethods", () => {
  it("keeps QRIS and documented VA / transfer banks, drops cc and out-of-limit methods", () => {
    const methods = toStoreMethods([
      { code: "qris", label: "QRIS", rail: "qris", bank: null, fee_payer: "merchant", fee_amount: 1050, total_amount: 150000, within_limits: true },
      { code: "va_bmri", label: "Mandiri VA", rail: "va", bank: "bmri", fee_payer: "customer", fee_amount: 4000, total_amount: 154000 },
      { code: "va_xxx", label: "Unknown VA", rail: "va", bank: "xxx" },
      { code: "cc", label: "Kartu kredit", rail: "cc", bank: null },
      { code: "tf_bca", label: "BCA", rail: "transfer", bank: "bca" },
      { code: "qris_big", label: "QRIS", rail: "qris", within_limits: false },
    ])
    expect(methods.map((m) => m.code)).toEqual(["qris", "va_bmri", "tf_bca"])
    expect(methods[1]).toMatchObject({ fee_amount: 4000, total_amount: 154000, fee_payer: "customer" })
    expect(methods[2].fee_amount).toBeNull()
  })
})

describe("StatusRefresher", () => {
  const payment = (status: string) => ({ id: "pay_1", status }) as DoitPayment

  it("reads at most once per refresh window and shares the request in flight", async () => {
    let t = 0
    const r = new StatusRefresher(() => t, 10_000, 60)
    const read = jest.fn(async () => payment("pending"))
    const [a, b] = await Promise.all([r.get("pay_1", read), r.get("pay_1", read)])
    expect(read).toHaveBeenCalledTimes(1)
    expect(a?.payment.status).toBe("pending")
    expect(b?.payment.status).toBe("pending")
    t = 9_999
    await r.get("pay_1", read)
    expect(read).toHaveBeenCalledTimes(1)
    t = 10_000
    read.mockResolvedValueOnce(payment("paid"))
    expect((await r.get("pay_1", read))?.payment.status).toBe("paid")
    expect(read).toHaveBeenCalledTimes(2)
  })

  it("stops reading when the per-minute budget is spent and serves the last value", async () => {
    let t = 0
    const r = new StatusRefresher(() => t, 1, 2)
    const read = jest.fn(async () => payment("pending"))
    await r.get("pay_a", read)
    await r.get("pay_b", read)
    expect(await r.get("pay_c", read)).toBeNull()
    t = 5
    expect((await r.get("pay_a", read))?.checkedAt).toBe(0)
    expect(read).toHaveBeenCalledTimes(2)
    t = 60_000
    await r.get("pay_c", read)
    expect(read).toHaveBeenCalledTimes(3)
  })

  it("a failed read falls back to the cached value or null", async () => {
    let t = 0
    const r = new StatusRefresher(() => t, 1, 60)
    expect(await r.get("pay_1", async () => { throw new Error("down") })).toBeNull()
    await r.get("pay_1", async () => payment("pending"))
    t = 10
    const out = await r.get("pay_1", async () => { throw new Error("down") })
    expect(out?.payment.status).toBe("pending")
  })
})

describe("RateLimiter", () => {
  it("allows `limit` hits per window and reports Retry-After seconds", () => {
    let t = 0
    const l = new RateLimiter(3, 60_000, () => t)
    expect([l.hit("ip"), l.hit("ip"), l.hit("ip")]).toEqual([0, 0, 0])
    expect(l.hit("ip")).toBe(60)
    expect(l.hit("other")).toBe(0)
    t = 59_500
    expect(l.hit("ip")).toBe(1)
    t = 60_000
    expect(l.hit("ip")).toBe(0)
  })

  it("does not grow without bound", () => {
    const l = new RateLimiter(1, 60_000, () => 0, 10)
    for (let i = 0; i < 25; i++) {
      expect(l.hit(`k${i}`)).toBe(0)
    }
  })
})
