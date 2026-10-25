import crypto from "node:crypto"
import type { CreatePaymentBody, DoitPayment, RefundBody } from "./types"

export const DEFAULT_BASE_URL = "https://pay.doit.id"
export const RATE_LIMIT_PER_MINUTE = 120
const DEFAULT_TIMEOUT_MS = 15_000
const DEFAULT_MAX_RETRIES = 2
const DEFAULT_MAX_RETRY_WAIT_MS = 15_000

/** Error answered by doit.id (`{ error: { code, message, doc_url } }`) or a transport failure. */
export class DoitApiError extends Error {
  readonly status: number
  readonly code: string
  readonly docUrl: string | null
  /** Seconds from the Retry-After header, when present. */
  readonly retryAfter: number | null

  constructor({
    status,
    code,
    message,
    docUrl = null,
    retryAfter = null,
  }: {
    status: number
    code: string
    message: string
    docUrl?: string | null
    retryAfter?: number | null
  }) {
    super(message)
    this.name = "DoitApiError"
    this.status = status
    this.code = code
    this.docUrl = docUrl
    this.retryAfter = retryAfter
  }

  /**
   * 429, 5xx and network errors are safe to repeat with the same Idempotency-Key.
   * 502 provider_refund_failed is the provider's final answer, not an outage.
   */
  get retryable(): boolean {
    if (this.code === "provider_refund_failed") {
      return false
    }
    return this.status === 0 || this.status === 429 || this.status >= 500
  }
}

/**
 * Token bucket of 120 requests/minute per API key, shared by every client in
 * the process. doit.id enforces the limit per key across all processes, so
 * this only keeps one process from tripping it; 429s are still handled.
 */
class TokenBucket {
  private tokens: number
  private last: number

  constructor(
    private readonly capacity: number,
    private readonly perMs: number,
    private readonly now: () => number
  ) {
    this.tokens = capacity
    this.last = now()
  }

  /** Milliseconds to wait before a token is available; takes it. */
  take(): number {
    const now = this.now()
    this.tokens = Math.min(this.capacity, this.tokens + (now - this.last) * this.perMs)
    this.last = now
    this.tokens -= 1
    return this.tokens >= 0 ? 0 : Math.ceil(-this.tokens / this.perMs)
  }
}

const BUCKETS_KEY = Symbol.for("medusa-payment-doit.rate-limit-buckets")
type BucketHolder = { [BUCKETS_KEY]?: Map<string, TokenBucket> }

function bucketFor(apiKey: string, now: () => number): TokenBucket {
  const holder = globalThis as BucketHolder
  const buckets = (holder[BUCKETS_KEY] ??= new Map())
  const id = crypto.createHash("sha256").update(apiKey).digest("hex").slice(0, 16)
  let bucket = buckets.get(id)
  if (!bucket) {
    bucket = new TokenBucket(RATE_LIMIT_PER_MINUTE, RATE_LIMIT_PER_MINUTE / 60_000, now)
    buckets.set(id, bucket)
  }
  return bucket
}

export function resetDoitRateLimiter(): void {
  ;(globalThis as BucketHolder)[BUCKETS_KEY]?.clear()
}

export type DoitClientOptions = {
  apiKey: string
  baseUrl?: string
  timeoutMs?: number
  maxRetries?: number
  maxRetryWaitMs?: number
  fetch?: typeof fetch
  sleep?: (ms: number) => Promise<void>
  now?: () => number
}

type RequestOptions = {
  query?: Record<string, string | number | undefined>
  body?: unknown
  idempotencyKey?: string
}

export class DoitClient {
  private readonly apiKey: string
  private readonly baseUrl: string
  private readonly timeoutMs: number
  private readonly maxRetries: number
  private readonly maxRetryWaitMs: number
  private readonly fetch_: typeof fetch
  private readonly sleep: (ms: number) => Promise<void>
  private readonly bucket: TokenBucket

  constructor(options: DoitClientOptions) {
    this.apiKey = options.apiKey
    this.baseUrl = (options.baseUrl ?? DEFAULT_BASE_URL).replace(/\/+$/, "")
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS
    this.maxRetries = options.maxRetries ?? DEFAULT_MAX_RETRIES
    this.maxRetryWaitMs = options.maxRetryWaitMs ?? DEFAULT_MAX_RETRY_WAIT_MS
    this.fetch_ = options.fetch ?? fetch
    this.sleep = options.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)))
    this.bucket = bucketFor(this.apiKey, options.now ?? Date.now)
  }

  createPayment(body: CreatePaymentBody, idempotencyKey: string): Promise<DoitPayment> {
    return this.request("POST", "/v1/payments", { body, idempotencyKey })
  }

  getPayment(id: string): Promise<DoitPayment> {
    return this.request("GET", `/v1/payments/${encodeURIComponent(id)}`)
  }

  listPayments(query: {
    status?: string
    reference?: string
    limit?: number
    before?: string
  } = {}): Promise<{ data: DoitPayment[] }> {
    return this.request("GET", "/v1/payments", { query })
  }

  /** Response shape is not documented; callers keep it as-is. */
  createRefund(
    paymentId: string,
    body: RefundBody,
    idempotencyKey: string
  ): Promise<Record<string, unknown>> {
    return this.request("POST", `/v1/payments/${encodeURIComponent(paymentId)}/refunds`, {
      body,
      idempotencyKey,
    })
  }

  listMethods(amount?: number): Promise<{ data: Record<string, unknown>[] }> {
    return this.request("GET", "/v1/methods", { query: { amount } })
  }

  private async request<T>(
    method: "GET" | "POST",
    path: string,
    { query, body, idempotencyKey }: RequestOptions = {}
  ): Promise<T> {
    if (method === "POST" && !idempotencyKey) {
      // doit.id answers 400 missing_idempotency_key; fail before spending a request.
      throw new DoitApiError({
        status: 400,
        code: "missing_idempotency_key",
        message: "Every POST to doit.id needs an Idempotency-Key",
      })
    }

    const url = new URL(this.baseUrl + path)
    for (const [k, v] of Object.entries(query ?? {})) {
      if (v !== undefined && v !== "") {
        url.searchParams.set(k, String(v))
      }
    }
    const headers: Record<string, string> = {
      Authorization: `Bearer ${this.apiKey}`,
      Accept: "application/json",
    }
    if (body !== undefined) {
      headers["Content-Type"] = "application/json"
    }
    if (idempotencyKey) {
      headers["Idempotency-Key"] = idempotencyKey
    }
    const payload = body === undefined ? undefined : JSON.stringify(body)

    for (let attempt = 0; ; attempt++) {
      const wait = this.bucket.take()
      if (wait > 0) {
        await this.sleep(wait)
      }

      let error: DoitApiError
      try {
        return await this.send<T>(method, url, headers, payload)
      } catch (e) {
        if (!(e instanceof DoitApiError)) {
          throw e
        }
        error = e
      }

      if (!error.retryable || attempt >= this.maxRetries) {
        throw error
      }
      const delay =
        error.retryAfter !== null ? error.retryAfter * 1000 : Math.min(500 * 2 ** attempt, 4000)
      if (delay > this.maxRetryWaitMs) {
        throw error
      }
      await this.sleep(delay)
    }
  }

  private async send<T>(
    method: string,
    url: URL,
    headers: Record<string, string>,
    payload: string | undefined
  ): Promise<T> {
    let res: Response
    try {
      res = await this.fetch_(url, {
        method,
        headers,
        body: payload,
        signal: AbortSignal.timeout(this.timeoutMs),
      })
    } catch (e) {
      const timedOut = (e as Error).name === "TimeoutError" || (e as Error).name === "AbortError"
      throw new DoitApiError({
        status: 0,
        code: timedOut ? "timeout" : "network_error",
        message: timedOut
          ? `doit.id did not answer within ${this.timeoutMs} ms`
          : `Could not reach doit.id: ${(e as Error).message}`,
      })
    }

    const text = await res.text()
    let json: unknown = undefined
    if (text) {
      try {
        json = JSON.parse(text)
      } catch {
        json = undefined
      }
    }

    if (res.ok && json !== undefined) {
      return json as T
    }

    const err = (json as { error?: { code?: string; message?: string; doc_url?: string } })?.error
    const retryAfterHeader = res.headers.get("retry-after")
    const retryAfter =
      retryAfterHeader && /^\d+$/.test(retryAfterHeader.trim()) ? Number(retryAfterHeader) : null
    throw new DoitApiError({
      status: res.ok ? 502 : res.status,
      code: err?.code ?? (res.ok ? "invalid_response" : `http_${res.status}`),
      message: err?.message ?? (res.ok ? "doit.id answered with a non-JSON body" : `doit.id answered HTTP ${res.status}`),
      docUrl: err?.doc_url ?? null,
      retryAfter,
    })
  }
}
