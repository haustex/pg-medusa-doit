import crypto from "node:crypto"
import { MedusaError } from "@medusajs/framework/utils"

/**
 * Secrets stored through the Admin are encrypted with AES-256-GCM using a
 * 32-byte key from DOIT_ENCRYPTION_KEY (64 hex chars, `openssl rand -hex 32`).
 *
 * Token format: `v1.<iv>.<tag>.<ciphertext>` (base64url). The field name is
 * bound as AAD so a ciphertext cannot be swapped between columns.
 */

const KEY_PATTERN = /^[0-9a-fA-F]{64}$/
const TOKEN_VERSION = "v1"

export type EncryptionKey =
  | { status: "ok"; key: Buffer; fingerprint: string }
  | { status: "missing" | "malformed" }

export function loadEncryptionKey(
  raw: string | undefined = process.env.DOIT_ENCRYPTION_KEY
): EncryptionKey {
  const value = raw?.trim()
  if (!value) {
    return { status: "missing" }
  }
  if (!KEY_PATTERN.test(value)) {
    return { status: "malformed" }
  }
  const key = Buffer.from(value, "hex")
  return { status: "ok", key, fingerprint: keyFingerprint(key) }
}

/**
 * Non-reversible identifier of the key, stored next to the ciphertexts so a
 * changed or wrong key is detected without attempting decryption.
 */
export function keyFingerprint(key: Buffer): string {
  return crypto
    .createHmac("sha256", key)
    .update("medusa-payment-doit/key-check")
    .digest("hex")
    .slice(0, 16)
}

export function encryptSecret(plain: string, key: Buffer, field: string): string {
  const iv = crypto.randomBytes(12)
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv)
  cipher.setAAD(Buffer.from(field))
  const ciphertext = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()])
  const tag = cipher.getAuthTag()
  return [TOKEN_VERSION, iv, tag, ciphertext]
    .map((part) => (typeof part === "string" ? part : part.toString("base64url")))
    .join(".")
}

/** Throws when the token is malformed or the key/field does not match. */
export function decryptSecret(token: string, key: Buffer, field: string): string {
  const [version, iv, tag, ciphertext] = token.split(".")
  if (version !== TOKEN_VERSION || !iv || !tag || ciphertext === undefined) {
    throw new MedusaError(MedusaError.Types.INVALID_DATA, "Unsupported ciphertext format")
  }
  const decipher = crypto.createDecipheriv(
    "aes-256-gcm",
    key,
    Buffer.from(iv, "base64url")
  )
  decipher.setAAD(Buffer.from(field))
  decipher.setAuthTag(Buffer.from(tag, "base64url"))
  return Buffer.concat([
    decipher.update(Buffer.from(ciphertext, "base64url")),
    decipher.final(),
  ]).toString("utf8")
}
