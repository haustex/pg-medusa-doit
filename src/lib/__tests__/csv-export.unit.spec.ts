import { csvCell, localTimestamp, toCsv } from "../csv-export"

describe("csv export", () => {
  it("neutralises spreadsheet formulas but keeps negative numbers", () => {
    expect(csvCell("=HYPERLINK(\"x\")")).toBe(`"'=HYPERLINK(""x"")"`)
    expect(csvCell("+62812")).toBe(`"'+62812"`)
    expect(csvCell("@SUM(A1)")).toBe(`"'@SUM(A1)"`)
    expect(csvCell("-25000")).toBe("-25000")
    expect(csvCell(150000)).toBe("150000")
    expect(csvCell("INV/001, A")).toBe('"INV/001, A"')
    expect(csvCell(["bayar_telat", "bayar_ganda"])).toBe("bayar_telat|bayar_ganda")
    expect(csvCell(null)).toBe("")
  })

  it("writes local times in the merchant's zone", () => {
    expect(localTimestamp("2026-10-25T17:30:00.000Z", "Asia/Jakarta")).toBe("2026-10-26 00:30:00")
    expect(localTimestamp(null, "Asia/Jakarta")).toBe("")
  })

  it("has a BOM, a header and one line per row", () => {
    const csv = toCsv([{ doit_id: "pay_1", reference: "=cmd", amount: 150000, paid_at: "2026-10-25T01:00:00Z", flags: ["bayar_telat"] }], "Asia/Jakarta")
    const lines = csv.replace(/^﻿/, "").trim().split("\r\n")
    expect(csv.startsWith("﻿")).toBe(true)
    expect(lines[0]).toMatch(/^doit_id,reference,order_id,status/)
    expect(lines[1]).toContain(`pay_1,"'=cmd"`)
    expect(lines[1]).toContain("2026-10-25 08:00:00")
    expect(lines[1]).toContain("bayar_telat")
  })
})
