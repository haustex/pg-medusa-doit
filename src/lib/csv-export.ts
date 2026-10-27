/** Columns of the transaction export, in order. */
export const EXPORT_COLUMNS = [
  ["doit_id", "doit_id"],
  ["reference", "reference"],
  ["order_id", "order_id"],
  ["status", "status"],
  ["rail", "rail"],
  ["va_bank", "va_bank"],
  ["amount", "gross"],
  ["fee_amount", "fee"],
  ["net_amount", "net"],
  ["total_amount", "total_dibayar"],
  ["fee_payer", "fee_payer"],
  ["refunded_amount", "refund"],
  ["flags", "flags"],
  ["environment", "environment"],
  ["doit_created_at", "dibuat"],
  ["paid_at", "dibayar"],
  ["expires_at", "kedaluwarsa"],
  // filled only when the export includes excluded rows
  ["excluded_reason", "dikecualikan"],
] as const

/** Local "YYYY-MM-DD HH:mm:ss" in the merchant's zone, so spreadsheets show what the Admin shows. */
export function localTimestamp(value: unknown, timezone: string): string {
  if (!value) return ""
  const d = value instanceof Date ? value : new Date(String(value))
  if (Number.isNaN(d.getTime())) return ""
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-CA", {
      timeZone: timezone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hourCycle: "h23",
    })
      .formatToParts(d)
      .map((p) => [p.type, p.value])
  )
  return `${parts.year}-${parts.month}-${parts.day} ${parts.hour}:${parts.minute}:${parts.second}`
}

/**
 * Quotes a cell; a value starting with = + - @ (or tab/CR) is prefixed with
 * an apostrophe so spreadsheets do not evaluate it (CSV formula injection).
 */
export function csvCell(value: unknown): string {
  let s = value === null || value === undefined ? "" : Array.isArray(value) ? value.join("|") : String(value)
  if (/^[=+\-@\t\r]/.test(s) && !/^-?\d+(\.\d+)?$/.test(s)) {
    s = `'${s}`
  }
  return /[",\r\n;]/.test(s) || s.startsWith("'") ? `"${s.replace(/"/g, '""')}"` : s
}

export function toCsv(rows: Record<string, unknown>[], timezone: string): string {
  const dates = new Set(["doit_created_at", "paid_at", "expires_at"])
  const lines = [EXPORT_COLUMNS.map(([, label]) => label).join(",")]
  for (const row of rows) {
    lines.push(
      EXPORT_COLUMNS.map(([key]) => csvCell(dates.has(key) ? localTimestamp(row[key], timezone) : row[key])).join(",")
    )
  }
  // BOM: Excel opens UTF-8 correctly
  return `﻿${lines.join("\r\n")}\r\n`
}
