const rupiah = new Intl.NumberFormat("id-ID", { style: "currency", currency: "IDR", maximumFractionDigits: 0 })
const number = new Intl.NumberFormat("id-ID")

/** Medusa and doit.id store rupiah as-is (150000 = Rp150.000): no scaling. */
export function formatRupiah(value: number | null | undefined): string {
  return rupiah.format(Number(value ?? 0))
}

export function formatCompactRupiah(value: number): string {
  if (Math.abs(value) >= 1_000_000) return `Rp${number.format(Math.round(value / 100_000) / 10)}jt`
  if (Math.abs(value) >= 1_000) return `Rp${number.format(Math.round(value / 1_000))}rb`
  return `Rp${number.format(value)}`
}

export function formatNumber(value: number): string {
  return number.format(value)
}

export function formatDateTime(value: string | null | undefined, timezone: string, locale: string): string {
  if (!value) return "–"
  return new Intl.DateTimeFormat(locale, {
    timeZone: timezone,
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value))
}

export function formatDay(value: string, locale: string): string {
  return new Intl.DateTimeFormat(locale, { day: "numeric", month: "short", timeZone: "UTC" }).format(
    new Date(`${value}T00:00:00Z`)
  )
}

/** Admin language → Intl locale. */
export function localeOf(language: string | undefined): string {
  return language?.startsWith("id") ? "id-ID" : "en-GB"
}
