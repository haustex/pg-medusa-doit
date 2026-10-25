import type { BigNumberInput } from "@medusajs/framework/types"
import { BigNumber, MedusaError } from "@medusajs/framework/utils"
import { TRANSFER_BANKS, VA_BANKS } from "../../lib/banks"
import type { DoitRail } from "../../lib/credentials"

/** doit.id only charges in rupiah. */
export function assertIdr(currencyCode: string | undefined): void {
  if ((currencyCode ?? "").toLowerCase() !== "idr") {
    throw new MedusaError(
      MedusaError.Types.INVALID_DATA,
      `doit.id hanya menerima IDR, bukan ${(currencyCode ?? "(kosong)").toUpperCase()}.`
    )
  }
}

/**
 * Converts a Medusa amount to doit.id's integer rupiah. Medusa stores prices
 * as-is (Rp150.000 = 150000), so no scaling happens here; anything with a
 * fractional part is rejected instead of rounded.
 */
export function toRupiah(amount: BigNumberInput | undefined, field = "amount"): number {
  let value: number | undefined
  try {
    const bn = amount === undefined || amount === null ? undefined : new BigNumber(amount).bigNumber
    if (bn && bn.isFinite() && bn.isInteger()) {
      value = bn.toNumber()
    } else if (bn && bn.isFinite()) {
      value = NaN
    }
  } catch {
    value = undefined
  }

  if (value === undefined) {
    throw new MedusaError(MedusaError.Types.INVALID_DATA, `${field} wajib berupa angka.`)
  }
  if (!Number.isInteger(value)) {
    throw new MedusaError(
      MedusaError.Types.INVALID_DATA,
      `${field} harus rupiah utuh tanpa pecahan (diterima ${String(amount)}).`
    )
  }
  if (value <= 0 || !Number.isSafeInteger(value)) {
    throw new MedusaError(
      MedusaError.Types.INVALID_DATA,
      `${field} harus lebih besar dari 0 (diterima ${String(amount)}).`
    )
  }
  return value
}

/** Checks the rail / va_bank pair before spending an API call on it. */
export function resolveRailBank(
  rail: DoitRail,
  vaBank: string | null | undefined
): { rail: DoitRail; va_bank?: string } {
  if (rail === "va") {
    if (!vaBank || !(VA_BANKS as readonly string[]).includes(vaBank)) {
      throw new MedusaError(
        MedusaError.Types.INVALID_DATA,
        `Rail va butuh va_bank salah satu dari ${VA_BANKS.join(", ")} (diterima ${vaBank ?? "kosong"}).`
      )
    }
    return { rail, va_bank: vaBank }
  }
  if (rail === "transfer") {
    if (!vaBank || !(TRANSFER_BANKS as readonly string[]).includes(vaBank)) {
      throw new MedusaError(
        MedusaError.Types.INVALID_DATA,
        `Rail transfer butuh va_bank salah satu dari ${TRANSFER_BANKS.join(", ")} (diterima ${vaBank ?? "kosong"}).`
      )
    }
    return { rail, va_bank: vaBank }
  }
  if (rail === "qris" || rail === "any") {
    return { rail }
  }
  throw new MedusaError(MedusaError.Types.INVALID_DATA, `Rail tidak dikenal: ${String(rail)}`)
}

/** return_url must be http(s) and ≤512 characters; anything else is dropped. */
export function sanitizeReturnUrl(value: unknown): string | undefined {
  if (typeof value !== "string" || !value || value.length > 512) {
    return undefined
  }
  try {
    const url = new URL(value)
    return url.protocol === "http:" || url.protocol === "https:" ? value : undefined
  } catch {
    return undefined
  }
}
