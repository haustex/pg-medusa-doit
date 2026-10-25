import { PaymentSessionStatus } from "@medusajs/framework/utils"
import { isPaidStatus, toSessionStatus } from "../status"

describe("toSessionStatus", () => {
  it.each([
    ["pending", PaymentSessionStatus.PENDING],
    ["paid", PaymentSessionStatus.CAPTURED],
    ["refunded", PaymentSessionStatus.CAPTURED],
    ["expired", PaymentSessionStatus.CANCELED],
    ["failed", PaymentSessionStatus.ERROR],
    ["something_new", PaymentSessionStatus.ERROR],
    [undefined, PaymentSessionStatus.ERROR],
  ])("%s → %s", (status, expected) => {
    expect(toSessionStatus(status as string)).toBe(expected)
  })

  it("isPaidStatus", () => {
    expect(isPaidStatus("paid")).toBe(true)
    expect(isPaidStatus("refunded")).toBe(true)
    expect(isPaidStatus("expired")).toBe(false)
  })
})
