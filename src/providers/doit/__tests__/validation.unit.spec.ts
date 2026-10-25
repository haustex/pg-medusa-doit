import { BigNumber, MedusaError } from "@medusajs/framework/utils"
import { assertIdr, resolveRailBank, sanitizeReturnUrl, toRupiah } from "../validation"

describe("assertIdr", () => {
  it("accepts IDR in any case", () => {
    expect(() => assertIdr("idr")).not.toThrow()
    expect(() => assertIdr("IDR")).not.toThrow()
  })

  it.each(["usd", "", undefined])("rejects %p", (code) => {
    expect(() => assertIdr(code)).toThrow(MedusaError)
  })
})

describe("toRupiah", () => {
  it("passes integers through unchanged (no ×100)", () => {
    expect(toRupiah(150000)).toBe(150000)
    expect(toRupiah("150000")).toBe(150000)
    expect(toRupiah(new BigNumber(150000))).toBe(150000)
    expect(toRupiah({ value: "150000", precision: 20 })).toBe(150000)
    expect(toRupiah(150000.0)).toBe(150000)
  })

  it.each([150000.5, "150000.01", 0.1])("rejects fractional %p", (v) => {
    expect(() => toRupiah(v)).toThrow(/tanpa pecahan/)
  })

  it.each([0, -1, "-5"])("rejects non-positive %p", (v) => {
    expect(() => toRupiah(v)).toThrow(/lebih besar dari 0/)
  })

  it.each([undefined, "abc", NaN, Infinity])("rejects non-numbers %p", (v) => {
    expect(() => toRupiah(v as never)).toThrow(MedusaError)
  })

  it("rejects values beyond safe integers", () => {
    expect(() => toRupiah("90071992547409930")).toThrow(MedusaError)
  })
})

describe("resolveRailBank", () => {
  it("qris and any need no bank and drop a stray one", () => {
    expect(resolveRailBank("qris", "bmri")).toEqual({ rail: "qris" })
    expect(resolveRailBank("any", null)).toEqual({ rail: "any" })
  })

  it("va needs a VA bank code", () => {
    expect(resolveRailBank("va", "bmri")).toEqual({ rail: "va", va_bank: "bmri" })
    expect(() => resolveRailBank("va", null)).toThrow(/va_bank/)
    expect(() => resolveRailBank("va", "bca")).toThrow(/va_bank/)
  })

  it("transfer needs a transfer bank code", () => {
    expect(resolveRailBank("transfer", "bca")).toEqual({ rail: "transfer", va_bank: "bca" })
    expect(() => resolveRailBank("transfer", "bmri")).toThrow(/transfer/)
  })

  it("rejects unknown rails", () => {
    expect(() => resolveRailBank("card" as never, null)).toThrow(/tidak dikenal/)
  })
})

describe("sanitizeReturnUrl", () => {
  it("keeps http(s) URLs up to 512 chars", () => {
    expect(sanitizeReturnUrl("https://toko.id/order/1")).toBe("https://toko.id/order/1")
    expect(sanitizeReturnUrl("http://localhost:8000/x")).toBe("http://localhost:8000/x")
  })

  it.each(["javascript:alert(1)", "ftp://x", "not a url", "https://x.id/" + "a".repeat(600), 42, undefined])(
    "drops %p",
    (v) => {
      expect(sanitizeReturnUrl(v)).toBeUndefined()
    }
  )
})
