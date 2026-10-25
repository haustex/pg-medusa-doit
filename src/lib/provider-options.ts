import { Modules } from "@medusajs/framework/utils"
import type { DoitProviderOptions } from "./credentials"

export const DOIT_PROVIDER_IDENTIFIER = "doit"

type ProviderEntry = { resolve?: unknown; id?: string; options?: Record<string, unknown> }
type ModuleEntry = { resolve?: unknown; options?: { providers?: ProviderEntry[] } } | boolean | string

/**
 * Finds the options of a doit provider registered in the Payment Module, from
 * the webhook route parameter (`<identifier>_<id>`, e.g. `doit_doit`).
 * Returns null when the parameter does not belong to a doit provider.
 */
export function getDoitProviderOptions(
  configModule: { modules?: Record<string, ModuleEntry> | ModuleEntry[] },
  providerParam: string
): DoitProviderOptions | null {
  const prefix = `${DOIT_PROVIDER_IDENTIFIER}_`
  if (!providerParam.startsWith(prefix)) {
    return null
  }
  const id = providerParam.slice(prefix.length)

  const modules = configModule.modules ?? {}
  const list: [string | undefined, ModuleEntry][] = Array.isArray(modules)
    ? modules.map((m) => [undefined, m])
    : Object.entries(modules)
  for (const [key, m] of list) {
    if (typeof m !== "object" || !m) {
      continue
    }
    const isPayment =
      key === Modules.PAYMENT ||
      (typeof m.resolve === "string" && /(^|\/)payment$/.test(m.resolve))
    if (!isPayment) {
      continue
    }
    const provider = (m.options?.providers ?? []).find(
      (p) =>
        p.id === id &&
        (typeof p.resolve !== "string" || p.resolve.includes("doit"))
    )
    if (provider) {
      return (provider.options ?? {}) as DoitProviderOptions
    }
  }
  // The route matches a doit provider id we could not find in the config:
  // still verify, using Admin / env credentials.
  return {}
}
