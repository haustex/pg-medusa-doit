import type { DoitCredentials } from "../credentials"
import { maskSecret } from "../mask"
import { toPublicSettings } from "../public-settings"

const API_KEY = "pb_test_FAKE_not_a_real_key_1a2b"
const WEBHOOK_SECRET = "whsec_Zx81Lq0pRt5uYv3Nm9Kd"

function creds(overrides: Partial<DoitCredentials> = {}): DoitCredentials {
  return {
    source: "admin",
    apiKey: API_KEY,
    webhookSecret: WEBHOOK_SECRET,
    environment: "sandbox",
    apiKeyHint: "pb_test_••••1a2b",
    rail: "qris",
    vaBank: null,
    expiresIn: 86400,
    timezone: "Asia/Jakarta",
    encryption: { status: "ok", message: null },
    adminUnavailable: false,
    ...overrides,
  }
}

describe("maskSecret", () => {
  it("keeps the pb_ prefix and only the last 4 characters", () => {
    expect(maskSecret(API_KEY)).toBe("pb_test_••••1a2b")
    expect(maskSecret("pb_live_FAKE_abcdefghijklmnop")).toBe("pb_live_••••mnop")
    expect(maskSecret(WEBHOOK_SECRET)).toBe("••••m9Kd")
  })

  it("reveals nothing for short values", () => {
    expect(maskSecret("pb_test_abc123")).toBe("pb_test_••••")
    expect(maskSecret("short")).toBe("••••")
  })

  it("returns null when unset", () => {
    expect(maskSecret(null)).toBeNull()
    expect(maskSecret(undefined)).toBeNull()
    expect(maskSecret("")).toBeNull()
  })
})

describe("toPublicSettings", () => {
  it("never contains the raw API key or webhook secret", () => {
    const json = JSON.stringify(toPublicSettings(creds()))

    expect(json).not.toContain(API_KEY)
    expect(json).not.toContain(WEBHOOK_SECRET)
    // nothing beyond the last 4 characters either
    expect(json).not.toContain(API_KEY.slice(-5))
    expect(json).not.toContain(WEBHOOK_SECRET.slice(-5))
    expect(json).not.toContain(API_KEY.slice("pb_test_".length, "pb_test_".length + 4))
  })

  it("exposes masked values and set flags", () => {
    const result = toPublicSettings(creds())

    expect(result.api_key).toEqual({ is_set: true, masked: "pb_test_••••1a2b" })
    expect(result.webhook_secret).toEqual({ is_set: true, masked: "••••m9Kd" })
    expect(result.configured).toBe(true)
  })

  it("reports unset secrets without a masked value", () => {
    const result = toPublicSettings(creds({ apiKey: null, webhookSecret: null, source: "none" }))

    expect(result.api_key).toEqual({ is_set: false, masked: null })
    expect(result.webhook_secret).toEqual({ is_set: false, masked: null })
    expect(result.configured).toBe(false)
  })

  it("only returns whitelisted keys", () => {
    expect(Object.keys(toPublicSettings(creds())).sort()).toEqual(
      [
        "api_key",
        "configured",
        "credential_source",
        "encryption",
        "environment",
        "expires_in",
        "rail",
        "show_credit",
        "timezone",
        "va_bank",
        "webhook_path",
        "webhook_secret",
        "webhook_url",
      ].sort()
    )
  })

  it("builds the webhook URL from the backend URL, without double slashes", () => {
    expect(toPublicSettings(creds()).webhook_url).toBeNull()
    expect(toPublicSettings(creds(), undefined, "https://api.toko.id/").webhook_url).toBe(
      "https://api.toko.id/hooks/payment/doit_doit"
    )
    expect(toPublicSettings(creds()).timezone).toBe("Asia/Jakarta")
  })
})
