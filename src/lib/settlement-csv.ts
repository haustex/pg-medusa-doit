import crypto from "node:crypto"
import { dateIn, isValidDate } from "./date-range"

/**
 * Settlement / payout CSV from the doit.id portal. The export format is not
 * documented, so columns are recognised by header name (Indonesian or
 * English) and the Admin shows the detected mapping and a preview before
 * anything is imported.
 */

export const MAX_CSV_BYTES = 2 * 1024 * 1024
export const MAX_CSV_ROWS = 5000

const HEADER_ALIASES: Record<"date" | "amount" | "fee" | "ref" | "status" | "note", string[]> = {
  date: ["tanggal", "date", "settlement_date", "tanggal_settlement", "tanggal_pencairan", "tanggal_transfer", "payout_date", "paid_out_at", "transferred_at", "created_at", "waktu"],
  amount: ["nominal", "amount", "jumlah", "net", "net_amount", "settlement_amount", "payout_amount", "jumlah_dicairkan", "dana_dicairkan", "total", "total_transfer"],
  fee: ["fee", "biaya", "biaya_payout", "payout_fee", "biaya_transfer", "admin_fee", "biaya_admin"],
  ref: ["id", "reference", "referensi", "ref", "settlement_id", "id_settlement", "payout_id", "id_payout", "id_pencairan", "no_ref", "nomor_referensi", "kode"],
  status: ["status", "state"],
  note: ["keterangan", "note", "catatan", "description", "deskripsi", "bank", "rekening"],
}

const SKIP_STATUSES = new Set(["failed", "gagal", "ditolak", "rejected", "canceled", "cancelled", "dibatalkan", "pending", "menunggu", "processing", "diproses"])

export type SettlementRow = {
  line: number
  date: string
  amount: number
  fee_amount: number
  external_ref: string
  note: string | null
  raw: Record<string, string>
}

export type SettlementParseResult = {
  columns: Partial<Record<keyof typeof HEADER_ALIASES, string>>
  rows: SettlementRow[]
  skipped: { line: number; reason: string }[]
  errors: { line: number; message: string }[]
}

function normalizeHeader(h: string): string {
  return h
    .replace(/^﻿/, "")
    .trim()
    .toLowerCase()
    .replace(/\(.*?\)/g, "")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_|_$/g, "")
}

/** RFC 4180-ish: quoted fields, doubled quotes, CRLF; delimiter `,` `;` or tab. */
export function parseCsv(text: string): string[][] {
  const clean = text.replace(/^﻿/, "")
  const firstLine = clean.split(/\r?\n/, 1)[0] ?? ""
  const delimiter = [";", "\t", ","].reduce((best, d) =>
    firstLine.split(d).length > firstLine.split(best).length ? d : best
  , ",")
  const rows: string[][] = []
  let row: string[] = []
  let field = ""
  let quoted = false
  for (let i = 0; i < clean.length; i++) {
    const c = clean[i]
    if (quoted) {
      if (c === '"' && clean[i + 1] === '"') {
        field += '"'
        i++
      } else if (c === '"') {
        quoted = false
      } else {
        field += c
      }
    } else if (c === '"' && field === "") {
      quoted = true
    } else if (c === delimiter) {
      row.push(field)
      field = ""
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && clean[i + 1] === "\n") i++
      row.push(field)
      rows.push(row)
      row = []
      field = ""
    } else {
      field += c
    }
  }
  if (field !== "" || row.length) {
    row.push(field)
    rows.push(row)
  }
  return rows.filter((r) => r.some((v) => v.trim() !== ""))
}

/**
 * "Rp1.500.000", "1,500,000", "1500000", "1.500.000,00" → 1500000.
 * Returns null for fractional rupiah or anything unreadable.
 */
export function parseRupiah(value: string): number | null {
  let v = value.trim().replace(/^rp\.?/i, "").replace(/\s/g, "")
  let negative = false
  if (/^\(.*\)$/.test(v)) {
    negative = true
    v = v.slice(1, -1)
  }
  if (v.startsWith("-")) {
    negative = true
    v = v.slice(1)
  }
  if (!/^[0-9.,]+$/.test(v)) return null
  // A last separator followed by 1–2 digits is a decimal part; only ",00" / ".00" is a whole rupiah.
  const decimal = v.match(/^(.+)[.,](\d{1,2})$/)
  if (decimal) {
    if (/[1-9]/.test(decimal[2])) return null
    v = decimal[1]
  }
  if (/^\d{1,3}([.,]\d{3})+$/.test(v)) {
    v = v.replace(/[.,]/g, "")
  }
  if (!/^\d+$/.test(v)) return null
  const n = Number(v)
  return Number.isSafeInteger(n) ? (negative ? -n : n) : null
}

/** YYYY-MM-DD, DD/MM/YYYY, DD-MM-YYYY, or an ISO timestamp (converted to the zone's date). */
export function parseSettlementDate(value: string, timezone: string): string | null {
  const v = value.trim()
  // (cast: isValidDate is a type guard and would narrow v to never below)
  if (isValidDate(v as unknown)) return v
  const dmy = v.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})(?:\s.*)?$/)
  if (dmy) {
    const date = `${dmy[3]}-${dmy[2].padStart(2, "0")}-${dmy[1].padStart(2, "0")}`
    return isValidDate(date) ? date : null
  }
  const ymd = v.match(/^(\d{4}-\d{2}-\d{2})[ T]/)
  if (/[zZ]|[+-]\d{2}:?\d{2}$/.test(v)) {
    const t = new Date(v)
    if (!Number.isNaN(t.getTime())) return dateIn(timezone, t)
  }
  if (ymd && isValidDate(ymd[1])) return ymd[1]
  return null
}

export function parseSettlementCsv(text: string, { timezone }: { timezone: string }): SettlementParseResult {
  const result: SettlementParseResult = { columns: {}, rows: [], skipped: [], errors: [] }
  const table = parseCsv(text)
  if (table.length < 2) {
    result.errors.push({ line: 1, message: "CSV kosong atau hanya berisi header." })
    return result
  }

  const headers = table[0].map(normalizeHeader)
  const index: Partial<Record<keyof typeof HEADER_ALIASES, number>> = {}
  for (const key of Object.keys(HEADER_ALIASES) as (keyof typeof HEADER_ALIASES)[]) {
    const i = headers.findIndex((h) => HEADER_ALIASES[key].includes(h))
    if (i >= 0) {
      index[key] = i
      result.columns[key] = table[0][i].replace(/^﻿/, "").trim()
    }
  }
  if (index.date === undefined || index.amount === undefined) {
    result.errors.push({
      line: 1,
      message: `Kolom tanggal dan nominal tidak ditemukan. Header yang dikenali: tanggal/date, nominal/amount/jumlah/net. Header file: ${table[0].join(", ")}`,
    })
    return result
  }

  const body = table.slice(1, MAX_CSV_ROWS + 1)
  if (table.length - 1 > MAX_CSV_ROWS) {
    result.errors.push({ line: MAX_CSV_ROWS + 2, message: `Maksimal ${MAX_CSV_ROWS} baris per import.` })
  }
  body.forEach((cells, i) => {
    const line = i + 2
    const cell = (k: keyof typeof HEADER_ALIASES) => (index[k] === undefined ? "" : (cells[index[k]!] ?? "").trim())
    const raw = Object.fromEntries(table[0].map((h, j) => [h.replace(/^﻿/, "").trim(), (cells[j] ?? "").trim()]))

    const status = cell("status").toLowerCase()
    if (status && SKIP_STATUSES.has(status)) {
      result.skipped.push({ line, reason: `status "${cell("status")}" bukan pencairan yang selesai` })
      return
    }
    const date = parseSettlementDate(cell("date"), timezone)
    const amount = parseRupiah(cell("amount"))
    const feeText = cell("fee")
    const fee = feeText ? parseRupiah(feeText) : 0
    if (!date) {
      result.errors.push({ line, message: `Tanggal tidak terbaca: "${cell("date")}"` })
      return
    }
    if (amount === null || amount <= 0) {
      result.errors.push({ line, message: `Nominal tidak valid (harus rupiah utuh > 0): "${cell("amount")}"` })
      return
    }
    if (fee === null || fee < 0) {
      result.errors.push({ line, message: `Biaya tidak valid: "${feeText}"` })
      return
    }
    const ref = cell("ref")
    result.rows.push({
      line,
      date,
      amount,
      fee_amount: fee,
      // without an id column, the row content is the identity, so a re-import is still skipped
      external_ref: ref
        ? `csv:${ref}`
        : `csv:${crypto.createHash("sha256").update(cells.map((c) => c.trim()).join("\u0001")).digest("hex").slice(0, 24)}`,
      note: cell("note") || null,
      raw,
    })
  })
  return result
}
