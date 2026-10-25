import { parseCsv, parseRupiah, parseSettlementCsv, parseSettlementDate } from "../settlement-csv"

describe("parseRupiah", () => {
  it.each([
    ["Rp1.500.000", 1500000],
    ["Rp 1.500.000,00", 1500000],
    ["1,500,000", 1500000],
    ["1,500,000.00", 1500000],
    ["1500000", 1500000],
    ["10.000", 10000],
    ["(10.000)", -10000],
    ["-25000", -25000],
  ])("%s → %d", (input, expected) => {
    expect(parseRupiah(input)).toBe(expected)
  })

  it.each(["1.500,50", "12.5", "abc", "", "Rp", "1,5,0"])("rejects %p", (input) => {
    expect(parseRupiah(input)).toBeNull()
  })
})

describe("parseSettlementDate", () => {
  it("reads common formats", () => {
    expect(parseSettlementDate("2026-10-24", "Asia/Jakarta")).toBe("2026-10-24")
    expect(parseSettlementDate("24/10/2026", "Asia/Jakarta")).toBe("2026-10-24")
    expect(parseSettlementDate("4-9-2026", "Asia/Jakarta")).toBe("2026-09-04")
    expect(parseSettlementDate("2026-10-24 09:00:00", "Asia/Jakarta")).toBe("2026-10-24")
    // 18:00 UTC is already the next day in Jakarta
    expect(parseSettlementDate("2026-10-24T18:00:00Z", "Asia/Jakarta")).toBe("2026-10-25")
    expect(parseSettlementDate("31/02/2026", "Asia/Jakarta")).toBeNull()
    expect(parseSettlementDate("kemarin", "Asia/Jakarta")).toBeNull()
  })
})

describe("parseCsv", () => {
  it("handles quotes, doubled quotes, CRLF, BOM and ; delimiters", () => {
    expect(parseCsv('﻿a,b\r\n"x, y","say ""hi"""\r\n')).toEqual([["a", "b"], ["x, y", 'say "hi"']])
    expect(parseCsv("a;b\n1;2\n\n")).toEqual([["a", "b"], ["1", "2"]])
  })
})

describe("parseSettlementCsv", () => {
  const tz = { timezone: "Asia/Jakarta" }

  it("maps Indonesian headers, skips unfinished payouts, reports bad rows", () => {
    const csv = [
      "ID Settlement;Tanggal;Nominal (Rp);Biaya;Status;Keterangan",
      "stl_001;24/10/2026;Rp1.490.000;Rp10.000;Selesai;BCA 1234",
      "stl_002;25/10/2026;Rp500.000;;Gagal;",
      "stl_003;bukan tanggal;Rp1;;Selesai;",
      "stl_004;26/10/2026;12,5;;Selesai;",
    ].join("\n")
    const r = parseSettlementCsv(csv, tz)
    expect(r.columns).toMatchObject({ ref: "ID Settlement", date: "Tanggal", amount: "Nominal (Rp)", fee: "Biaya", status: "Status" })
    expect(r.rows).toEqual([
      expect.objectContaining({ line: 2, date: "2026-10-24", amount: 1490000, fee_amount: 10000, external_ref: "csv:stl_001", note: "BCA 1234" }),
    ])
    expect(r.skipped).toEqual([{ line: 3, reason: expect.stringContaining("Gagal") }])
    expect(r.errors.map((e) => e.line)).toEqual([4, 5])
  })

  it("uses the row content as identity when there is no id column", () => {
    const csv = "date,amount\n2026-10-24,1000000\n2026-10-24,1000000\n2026-10-25,2000000\n"
    const r = parseSettlementCsv(csv, tz)
    expect(r.rows).toHaveLength(3)
    expect(r.rows[0].external_ref).toBe(r.rows[1].external_ref)
    expect(r.rows[2].external_ref).not.toBe(r.rows[0].external_ref)
    expect(parseSettlementCsv(csv, tz).rows[2].external_ref).toBe(r.rows[2].external_ref)
  })

  it("explains missing columns", () => {
    expect(parseSettlementCsv("foo,bar\n1,2", tz).errors[0].message).toMatch(/tanggal dan nominal/)
    expect(parseSettlementCsv("", tz).errors[0].message).toMatch(/kosong/)
  })
})
