import type { MedusaNextFunction, MedusaRequest, MedusaResponse } from "@medusajs/framework/http"

type Window = { count: number; resetAt: number }

/**
 * Fixed-window counter per key, in process memory. Each Medusa server process
 * counts on its own, so behind N instances a client gets at most N × limit.
 * Good enough to stop a runaway polling loop; not a security boundary.
 */
export class RateLimiter {
  private readonly windows = new Map<string, Window>()

  constructor(
    private readonly limit: number,
    private readonly windowMs: number,
    private readonly now: () => number = Date.now,
    private readonly maxKeys = 50_000
  ) {}

  /** Seconds until the key may try again, or 0 when the hit is allowed (and counted). */
  hit(key: string): number {
    const now = this.now()
    let w = this.windows.get(key)
    if (!w || w.resetAt <= now) {
      if (this.windows.size >= this.maxKeys) {
        this.sweep(now)
      }
      w = { count: 0, resetAt: now + this.windowMs }
      this.windows.set(key, w)
    }
    if (w.count >= this.limit) {
      return Math.max(1, Math.ceil((w.resetAt - now) / 1000))
    }
    w.count++
    return 0
  }

  private sweep(now: number): void {
    for (const [key, w] of this.windows) {
      if (w.resetAt <= now) {
        this.windows.delete(key)
      }
    }
    // Still full (a flood of distinct keys): start over rather than grow without bound.
    if (this.windows.size >= this.maxKeys) {
      this.windows.clear()
    }
  }
}

export type StoreRateLimitOptions = {
  /** Requests per minute per client IP. */
  perIp: number
  /** Requests per minute per cart (route param `id` or query `cart_id`). */
  perCart?: number
}

function cartKeyOf(req: MedusaRequest): string | null {
  const fromParam = (req.params as Record<string, string> | undefined)?.id
  const fromQuery = (req.query as Record<string, unknown> | undefined)?.cart_id
  const id = fromParam ?? (typeof fromQuery === "string" ? fromQuery : null)
  return id ? id.slice(0, 64) : null
}

/**
 * 429 `rate_limited` with Retry-After once a client IP or a cart goes over its
 * budget. The IP comes from Express (`req.ip`), so it honours the app's
 * trust-proxy setting.
 */
export function storeRateLimit({ perIp, perCart }: StoreRateLimitOptions) {
  const byIp = new RateLimiter(perIp, 60_000)
  const byCart = perCart ? new RateLimiter(perCart, 60_000) : null

  return function doitStoreRateLimit(req: MedusaRequest, res: MedusaResponse, next: MedusaNextFunction) {
    const ip = req.ip ?? req.socket?.remoteAddress ?? "unknown"
    let retryAfter = byIp.hit(ip)
    const cartKey = cartKeyOf(req)
    if (!retryAfter && byCart && cartKey) {
      retryAfter = byCart.hit(cartKey)
    }
    if (retryAfter) {
      res.setHeader("Retry-After", String(retryAfter))
      res.status(429).json({
        type: "rate_limited",
        message: `Terlalu banyak permintaan. Coba lagi dalam ${retryAfter} detik.`,
      })
      return
    }
    next()
  }
}
