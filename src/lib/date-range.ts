import { MedusaError } from "@medusajs/framework/utils"

export const DEFAULT_TIMEZONE = "Asia/Jakarta"
export const MAX_RANGE_DAYS = 366
export const RANGE_PRESETS = ["today", "7d", "month", "custom"] as const
export type RangePreset = (typeof RANGE_PRESETS)[number]

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/

export function isValidTimezone(tz: unknown): tz is string {
  if (typeof tz !== "string" || !tz) return false
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz })
    return true
  } catch {
    return false
  }
}

export function isValidDate(value: unknown): value is string {
  if (typeof value !== "string" || !DATE_PATTERN.test(value)) return false
  const d = new Date(`${value}T00:00:00Z`)
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === value
}

/** Calendar date (YYYY-MM-DD) of an instant in a time zone. */
export function dateIn(tz: string, instant: Date = new Date()): string {
  // en-CA formats as YYYY-MM-DD
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(instant)
}

/** Pure calendar arithmetic on YYYY-MM-DD strings (no time zone involved). */
export function addDays(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + days)
  return d.toISOString().slice(0, 10)
}

export function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000)
}

export type ResolvedRange = {
  preset: RangePreset
  /** first day, inclusive */
  from: string
  /** last day, inclusive */
  to: string
  timezone: string
}

/**
 * Turns a preset (or a custom from/to) into calendar dates in the merchant's
 * time zone. Day boundaries are applied in SQL (`date::timestamp AT TIME ZONE tz`).
 */
export function resolveRange(
  { preset = "7d", from, to, timezone }: { preset?: string; from?: string; to?: string; timezone: string },
  now: Date = new Date()
): ResolvedRange {
  const tz = isValidTimezone(timezone) ? timezone : DEFAULT_TIMEZONE
  const today = dateIn(tz, now)
  switch (preset) {
    case "today":
      return { preset, from: today, to: today, timezone: tz }
    case "7d":
      return { preset, from: addDays(today, -6), to: today, timezone: tz }
    case "month":
      return { preset, from: `${today.slice(0, 8)}01`, to: today, timezone: tz }
    case "custom": {
      if (!isValidDate(from) || !isValidDate(to)) {
        throw new MedusaError(MedusaError.Types.INVALID_DATA, "from dan to harus tanggal YYYY-MM-DD.")
      }
      if (from > to) {
        throw new MedusaError(MedusaError.Types.INVALID_DATA, "from tidak boleh setelah to.")
      }
      if (daysBetween(from, to) + 1 > MAX_RANGE_DAYS) {
        throw new MedusaError(MedusaError.Types.INVALID_DATA, `Rentang maksimal ${MAX_RANGE_DAYS} hari.`)
      }
      return { preset, from, to, timezone: tz }
    }
    default:
      throw new MedusaError(MedusaError.Types.INVALID_DATA, `Preset rentang tidak dikenal: ${preset}`)
  }
}

/** Every date from..to inclusive, for filling days without transactions. */
export function eachDay(from: string, to: string): string[] {
  const days: string[] = []
  for (let d = from; d <= to; d = addDays(d, 1)) {
    days.push(d)
  }
  return days
}
