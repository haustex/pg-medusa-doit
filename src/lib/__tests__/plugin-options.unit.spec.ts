import { getDoitPluginOptions } from "../plugin-options"

describe("getDoitPluginOptions", () => {
  it("defaults showCredit to true when the plugin has no options", () => {
    expect(getDoitPluginOptions({ plugins: ["medusa-payment-doit"] })).toEqual({ showCredit: true })
    expect(getDoitPluginOptions({ plugins: [] })).toEqual({ showCredit: true })
    expect(getDoitPluginOptions({})).toEqual({ showCredit: true })
  })

  it("reads showCredit: false", () => {
    expect(
      getDoitPluginOptions({
        plugins: [{ resolve: "medusa-payment-doit", options: { showCredit: false } }],
      })
    ).toEqual({ showCredit: false })
  })

  it("matches a path ending in the package name", () => {
    expect(
      getDoitPluginOptions({
        plugins: [{ resolve: "./plugins/medusa-payment-doit", options: { showCredit: false } }],
      })
    ).toEqual({ showCredit: false })
  })

  it("ignores other plugins and non-boolean values", () => {
    expect(
      getDoitPluginOptions({
        plugins: [
          { resolve: "medusa-payment-other", options: { showCredit: false } },
          { resolve: "medusa-payment-doit", options: { showCredit: "no" } },
        ],
      })
    ).toEqual({ showCredit: true })
  })
})
