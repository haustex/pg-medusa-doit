import type { MedusaRequest } from "@medusajs/framework/http"
import { ContainerRegistrationKeys, MedusaError } from "@medusajs/framework/utils"
import type { z } from "@medusajs/framework/zod"
import type { Mode } from "../modules/doitLedger/reports"
import { type DoitCredentials, resolveDoitCredentials } from "./credentials"
import { getDoitProviderOptions } from "./provider-options"

/** Credentials as the doit provider sees them (Admin → provider options → env). */
export async function loadCredentials(req: MedusaRequest, { fresh = false } = {}): Promise<DoitCredentials> {
  const config = req.scope.resolve(ContainerRegistrationKeys.CONFIG_MODULE)
  return resolveDoitCredentials(
    req.scope.resolve(ContainerRegistrationKeys.PG_CONNECTION),
    getDoitProviderOptions(config as never, "doit_doit") ?? {},
    { fresh, logger: req.scope.resolve(ContainerRegistrationKeys.LOGGER) }
  )
}

/** live for a pb_live_ key, test otherwise: the dashboard never mixes the two. */
export function modeOf(creds: Pick<DoitCredentials, "environment">): Mode {
  return creds.environment === "production" ? "live" : "test"
}

/**
 * Backend origin for the webhook URL shown in the Admin: admin.backendUrl when
 * it is absolute, else the origin this request came in on.
 */
export function backendUrlOf(req: MedusaRequest): string | null {
  const config = req.scope.resolve(ContainerRegistrationKeys.CONFIG_MODULE) as { admin?: { backendUrl?: string } }
  const configured = config.admin?.backendUrl
  if (configured && /^https?:\/\//.test(configured)) {
    return configured
  }
  const host = req.get?.("x-forwarded-host") ?? req.get?.("host")
  if (!host) {
    return null
  }
  const proto = (req.get?.("x-forwarded-proto") ?? req.protocol ?? "http").split(",")[0].trim()
  return `${proto}://${host}`
}

/** Parses query parameters with a Zod schema; invalid input becomes a 400. */
export function parseQuery<T extends z.ZodTypeAny>(schema: T, query: unknown): z.infer<T> {
  const result = schema.safeParse(query)
  if (!result.success) {
    const issue = result.error.issues[0]
    throw new MedusaError(
      MedusaError.Types.INVALID_DATA,
      `${issue?.path?.join(".") || "query"}: ${issue?.message ?? "tidak valid"}`
    )
  }
  return result.data
}
