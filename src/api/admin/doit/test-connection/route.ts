import type { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { ContainerRegistrationKeys, MedusaError } from "@medusajs/framework/utils"
import { loadCredentials } from "../../../../lib/admin-context"
import { environmentFromKey } from "../../../../lib/credentials"
import { DoitApiError, DoitClient } from "../../../../providers/doit/client"
import { getDoitProviderOptions } from "../../../../lib/provider-options"
import type { PostAdminDoitTestConnectionType } from "../validators"

/** Rails offered by the plugin; anything else doit.id reports (e.g. "cc") is not documented and not shown. */
const DOCUMENTED_RAILS = new Set(["qris", "va", "transfer"])

/**
 * Calls GET /v1/methods with the stored key (or one typed in the form) and
 * reports which methods are active. Read-only on both sides.
 */
export async function POST(
  req: AuthenticatedMedusaRequest<PostAdminDoitTestConnectionType>,
  res: MedusaResponse
) {
  const creds = await loadCredentials(req, { fresh: true })
  const apiKey = req.validatedBody.api_key || creds.apiKey
  if (!apiKey) {
    throw new MedusaError(MedusaError.Types.INVALID_DATA, "Belum ada API key untuk dites.")
  }
  const options = getDoitProviderOptions(req.scope.resolve(ContainerRegistrationKeys.CONFIG_MODULE) as never, "doit_doit") ?? {}
  const client = new DoitClient({ apiKey, baseUrl: options.api_base_url, maxRetries: 0, timeoutMs: 10_000 })
  const keyMode = environmentFromKey(apiKey) === "production" ? "live" : "test"
  const started = Date.now()
  try {
    const result = (await client.listMethods()) as { environment?: string; data?: Record<string, unknown>[] }
    const reported = typeof result.environment === "string" ? result.environment : null
    const reportedMode = reported === "live" || reported === "production" ? "live" : reported ? "test" : null
    res.json({
      ok: true,
      latency_ms: Date.now() - started,
      key_mode: keyMode,
      environment: reported,
      mode_mismatch: reportedMode !== null && reportedMode !== keyMode,
      methods: (result.data ?? [])
        .filter((m) => DOCUMENTED_RAILS.has(String(m.rail)))
        .map((m) => ({ code: m.code, label: m.label, rail: m.rail, bank: m.bank ?? null, fee_payer: m.fee_payer ?? null })),
    })
  } catch (e) {
    const err = e instanceof DoitApiError ? e : null
    res.json({
      ok: false,
      latency_ms: Date.now() - started,
      key_mode: keyMode,
      error: {
        status: err?.status ?? 0,
        code: err?.code ?? "unknown",
        // doit.id messages never contain the key
        message: err?.message ?? "Tidak bisa menghubungi doit.id",
      },
    })
  }
}
