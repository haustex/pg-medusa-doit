export const PACKAGE_NAME = "medusa-payment-doit"

/** Options passed in medusa-config.ts: `plugins: [{ resolve: "medusa-payment-doit", options }]`. */
export type DoitPluginOptions = {
  /** Show the "PG Medusa Doit.id · by Haus Kayu" credit in the Admin pages. Default true. */
  showCredit?: boolean
}

type PluginEntry = string | { resolve?: string; options?: Record<string, unknown> }

export function getDoitPluginOptions(configModule: {
  plugins?: PluginEntry[]
}): Required<DoitPluginOptions> {
  const entry = (configModule.plugins ?? []).find((p) => {
    const resolve = typeof p === "string" ? p : p.resolve
    return !!resolve && (resolve === PACKAGE_NAME || resolve.endsWith(`/${PACKAGE_NAME}`))
  })
  const options = typeof entry === "object" ? entry.options ?? {} : {}

  return {
    showCredit: typeof options.showCredit === "boolean" ? options.showCredit : true,
  }
}
