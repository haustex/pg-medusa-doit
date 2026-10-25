import { getDoitProviderOptions } from "../provider-options"

const options = { webhook_secret: "whsec_FAKE", late_payment_policy: "flag" }

describe("getDoitProviderOptions", () => {
  it("finds the doit provider by webhook route parameter", () => {
    const config = {
      modules: {
        payment: {
          resolve: "@medusajs/medusa/payment",
          options: {
            providers: [
              { resolve: "@medusajs/medusa/payment-stripe", id: "stripe", options: { apiKey: "x" } },
              { resolve: "medusa-payment-doit/providers/doit", id: "doit", options },
            ],
          },
        },
      },
    }
    expect(getDoitProviderOptions(config, "doit_doit")).toBe(options)
  })

  it("supports a custom provider id and the array form of modules", () => {
    const config = {
      modules: [
        {
          resolve: "@medusajs/medusa/payment",
          options: { providers: [{ resolve: "medusa-payment-doit/providers/doit", id: "live", options }] },
        },
      ],
    }
    expect(getDoitProviderOptions(config, "doit_live")).toBe(options)
  })

  it("returns null for other providers", () => {
    expect(getDoitProviderOptions({ modules: {} }, "stripe_stripe")).toBeNull()
    expect(getDoitProviderOptions({ modules: {} }, "doitfoo")).toBeNull()
  })

  it("returns empty options for an unknown doit id (Admin / env credentials still apply)", () => {
    expect(getDoitProviderOptions({ modules: {} }, "doit_doit")).toEqual({})
  })
})
