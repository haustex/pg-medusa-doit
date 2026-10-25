import crypto from "node:crypto"

export const SIGNATURE_HEADER = "paybridge-signature"
/** Reject signatures whose timestamp is further than this from now. */
export const DEFAULT_SIGNATURE_TOLERANCE_SECONDS = 300

export type SignatureVerification =
  | { valid: true; timestamp: number }
  | {
      valid: false
      reason:
        | "missing_header"
        | "malformed_header"
        | "missing_body"
        | "timestamp_out_of_range"
        | "mismatch"
    }

/**
 * The exact bytes received. Medusa passes a Buffer; after a trip through the
 * Redis event bus it can arrive as `{ type: "Buffer", data: [...] }`.
 */
export function toRawBody(raw: unknown): Buffer | null {
  if (Buffer.isBuffer(raw)) {
    return raw
  }
  if (typeof raw === "string") {
    return Buffer.from(raw, "utf8")
  }
  if (
    raw &&
    typeof raw === "object" &&
    (raw as { type?: unknown }).type === "Buffer" &&
    Array.isArray((raw as { data?: unknown }).data)
  ) {
    return Buffer.from((raw as { data: number[] }).data)
  }
  return null
}

export function parseSignatureHeader(
  header: string
): { t: string; v1: string[] } | null {
  let t: string | undefined
  const v1: string[] = []
  for (const part of header.split(",")) {
    const idx = part.indexOf("=")
    if (idx <= 0) {
      continue
    }
    const name = part.slice(0, idx).trim()
    const value = part.slice(idx + 1).trim()
    if (name === "t") {
      t = value
    } else if (name === "v1") {
      v1.push(value)
    }
  }
  if (!t || !/^\d+$/.test(t) || v1.length === 0) {
    return null
  }
  return { t, v1 }
}

export function computeSignature(
  secret: string,
  timestamp: string,
  rawBody: string | Buffer
): string {
  return crypto
    .createHmac("sha256", secret)
    .update(`${timestamp}.`)
    .update(rawBody)
    .digest("hex")
}

/**
 * Verifies `PayBridge-Signature: t=<unix>,v1=<hex>` where
 * v1 = HMAC_SHA256(secret, t + "." + rawBody). The body must be the exact
 * bytes received, not re-serialised JSON.
 */
export function verifySignature({
  rawBody,
  header,
  secret,
  toleranceSeconds = DEFAULT_SIGNATURE_TOLERANCE_SECONDS,
  now = Date.now(),
}: {
  rawBody: unknown
  header: string | string[] | undefined
  secret: string
  toleranceSeconds?: number
  now?: number
}): SignatureVerification {
  const value = Array.isArray(header) ? header[0] : header
  if (!value) {
    return { valid: false, reason: "missing_header" }
  }
  const parsed = parseSignatureHeader(value)
  if (!parsed) {
    return { valid: false, reason: "malformed_header" }
  }

  const body = toRawBody(rawBody)
  if (!body) {
    return { valid: false, reason: "missing_body" }
  }

  const timestamp = Number(parsed.t)
  if (toleranceSeconds > 0 && Math.abs(now / 1000 - timestamp) > toleranceSeconds) {
    return { valid: false, reason: "timestamp_out_of_range" }
  }

  const expected = Buffer.from(computeSignature(secret, parsed.t, body), "hex")
  const matches = parsed.v1.some((candidate) => {
    if (!/^[0-9a-fA-F]+$/.test(candidate)) {
      return false
    }
    const given = Buffer.from(candidate, "hex")
    // timingSafeEqual throws on length mismatch; the length of a hex digest is not secret.
    return given.length === expected.length && crypto.timingSafeEqual(given, expected)
  })

  return matches ? { valid: true, timestamp } : { valid: false, reason: "mismatch" }
}
