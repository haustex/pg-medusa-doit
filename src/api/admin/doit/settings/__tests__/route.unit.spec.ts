import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import { encryptSecret, keyFingerprint } from "../../../../../lib/crypto"
import { invalidateDoitCredentialsCache } from "../../../../../lib/credentials"
import { GET } from "../route"

const ENCRYPTION_KEY = "a".repeat(64)
const API_KEY = "pb_live_FAKE_not_a_real_key_4Df6"
const WEBHOOK_SECRET = "whsec_Hj8Kl0Zx2Cv4Bn6Mq8Wp"

/** Minimal stand-in for the knex query used by resolveDoitCredentials. */
function fakePg(row: Record<string, unknown> | undefined) {
  const builder = {
    select: () => builder,
    whereNull: () => builder,
    orderBy: () => builder,
    first: async () => row,
  }
  return () => builder
}

function storedRow(encryptionKey = ENCRYPTION_KEY) {
  const key = Buffer.from(encryptionKey, "hex")
  return {
    api_key_encrypted: encryptSecret(API_KEY, key, "api_key"),
    api_key_hint: "pb_live_••••4Df6",
    webhook_secret_encrypted: encryptSecret(WEBHOOK_SECRET, key, "webhook_secret"),
    encryption_key_fingerprint: keyFingerprint(key),
    rail: "va",
    va_bank: "bmri",
    expires_in: 3600,
  }
}

async function callGet(row: Record<string, unknown> | undefined) {
  const services: Record<string, unknown> = {
    [ContainerRegistrationKeys.PG_CONNECTION]: fakePg(row),
    [ContainerRegistrationKeys.LOGGER]: { warn: jest.fn() },
    [ContainerRegistrationKeys.CONFIG_MODULE]: { plugins: [] },
  }
  const req = { scope: { resolve: (name: string) => services[name] } }
  const res = { json: jest.fn() }
  await GET(req as never, res as never)
  expect(res.json).toHaveBeenCalledTimes(1)
  return res.json.mock.calls[0][0]
}

describe("GET /admin/doit/settings", () => {
  const originalEnv = { ...process.env }

  beforeEach(() => {
    invalidateDoitCredentialsCache()
    process.env = { ...originalEnv, DOIT_ENCRYPTION_KEY: ENCRYPTION_KEY }
    delete process.env.DOIT_API_KEY
    delete process.env.DOIT_WEBHOOK_SECRET
  })

  afterAll(() => {
    process.env = originalEnv
  })

  it("returns masked values and set flags, never the decrypted secrets", async () => {
    const body = await callGet(storedRow())
    const json = JSON.stringify(body)

    expect(json).not.toContain(API_KEY)
    expect(json).not.toContain(WEBHOOK_SECRET)
    expect(json).not.toContain(API_KEY.slice(-5))
    expect(json).not.toContain(WEBHOOK_SECRET.slice(-5))
    // ciphertexts stay server-side too
    expect(json).not.toContain("v1.")

    expect(body.settings.api_key).toEqual({ is_set: true, masked: "pb_live_••••4Df6" })
    expect(body.settings.webhook_secret).toEqual({ is_set: true, masked: "••••q8Wp" })
    expect(body.settings.credential_source).toBe("admin")
    expect(body.settings.environment).toBe("production")
  })

  it("does not leak env credentials either", async () => {
    process.env.DOIT_API_KEY = API_KEY
    process.env.DOIT_WEBHOOK_SECRET = WEBHOOK_SECRET

    const body = await callGet(undefined)
    const json = JSON.stringify(body)

    expect(body.settings.credential_source).toBe("env")
    expect(json).not.toContain(API_KEY)
    expect(json).not.toContain(WEBHOOK_SECRET)
    expect(body.settings.api_key.is_set).toBe(true)
    expect(body.settings.webhook_secret.is_set).toBe(true)
  })

  it("reports unset when nothing is configured", async () => {
    const body = await callGet(undefined)

    expect(body.settings.api_key).toEqual({ is_set: false, masked: null })
    expect(body.settings.webhook_secret).toEqual({ is_set: false, masked: null })
    expect(body.settings.configured).toBe(false)
  })

  it("shows the invalid-key warning without leaking anything when DOIT_ENCRYPTION_KEY is wrong", async () => {
    const row = storedRow()
    process.env.DOIT_ENCRYPTION_KEY = "b".repeat(64)

    const body = await callGet(row)
    const json = JSON.stringify(body)

    expect(body.settings.encryption).toEqual({
      status: "mismatch",
      message: "Kunci enkripsi tidak valid, masukkan ulang kredensial.",
    })
    expect(body.settings.api_key.is_set).toBe(false)
    expect(json).not.toContain(API_KEY)
    expect(json).not.toContain(WEBHOOK_SECRET)
  })

  it("shows the warning when DOIT_ENCRYPTION_KEY is missing", async () => {
    const row = storedRow()
    delete process.env.DOIT_ENCRYPTION_KEY

    const body = await callGet(row)

    expect(body.settings.encryption.status).toBe("missing")
    expect(body.settings.encryption.message).toBe(
      "Kunci enkripsi tidak valid, masukkan ulang kredensial."
    )
  })
})
