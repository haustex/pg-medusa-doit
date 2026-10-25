import { addDays, dateIn, eachDay, isValidDate, isValidTimezone, resolveRange } from "../date-range"

// 2026-10-25 17:30 UTC = 2026-10-26 00:30 in Jakarta (UTC+7)
const NOW = new Date("2026-10-25T17:30:00Z")

describe("date-range", () => {
  it("validates zones and dates", () => {
    expect(isValidTimezone("Asia/Jakarta")).toBe(true)
    expect(isValidTimezone("Mars/Base")).toBe(false)
    expect(isValidDate("2026-02-29")).toBe(false)
    expect(isValidDate("2028-02-29")).toBe(true)
    expect(isValidDate("2026-1-1")).toBe(false)
  })

  it("today is the local calendar day in the merchant's zone", () => {
    expect(dateIn("Asia/Jakarta", NOW)).toBe("2026-10-26")
    expect(dateIn("UTC", NOW)).toBe("2026-10-25")
    expect(resolveRange({ preset: "today", timezone: "Asia/Jakarta" }, NOW)).toMatchObject({ from: "2026-10-26", to: "2026-10-26" })
  })

  it("7 days and this month end today", () => {
    expect(resolveRange({ preset: "7d", timezone: "Asia/Jakarta" }, NOW)).toMatchObject({ from: "2026-10-20", to: "2026-10-26" })
    expect(resolveRange({ preset: "month", timezone: "Asia/Jakarta" }, NOW)).toMatchObject({ from: "2026-10-01", to: "2026-10-26" })
    expect(resolveRange({ preset: "month", timezone: "UTC" }, new Date("2026-11-01T03:00:00Z"))).toMatchObject({ from: "2026-11-01" })
  })

  it("custom ranges are validated", () => {
    expect(resolveRange({ preset: "custom", from: "2026-09-01", to: "2026-09-30", timezone: "Asia/Jakarta" })).toMatchObject({
      from: "2026-09-01",
      to: "2026-09-30",
    })
    expect(() => resolveRange({ preset: "custom", from: "2026-09-30", to: "2026-09-01", timezone: "UTC" })).toThrow(/setelah/)
    expect(() => resolveRange({ preset: "custom", from: "2025-01-01", to: "2026-09-01", timezone: "UTC" })).toThrow(/366/)
    expect(() => resolveRange({ preset: "custom", from: "x", to: "2026-09-01", timezone: "UTC" })).toThrow(/YYYY-MM-DD/)
    expect(() => resolveRange({ preset: "year", timezone: "UTC" })).toThrow(/tidak dikenal/)
  })

  it("falls back to Asia/Jakarta for an invalid zone", () => {
    expect(resolveRange({ preset: "today", timezone: "nope" }, NOW).timezone).toBe("Asia/Jakarta")
  })

  it("calendar helpers", () => {
    expect(addDays("2026-02-28", 1)).toBe("2026-03-01")
    expect(addDays("2026-03-01", -1)).toBe("2026-02-28")
    expect(eachDay("2026-10-30", "2026-11-02")).toEqual(["2026-10-30", "2026-10-31", "2026-11-01", "2026-11-02"])
  })
})
