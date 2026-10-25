/** va_bank codes accepted by doit.id for rail=va. */
export const VA_BANKS = ["bmri", "bnia", "brin", "cimb", "permata", "maybank", "danamon", "bsyi"] as const
/** va_bank codes accepted by doit.id for rail=transfer (Mutasi Rekening). */
export const TRANSFER_BANKS = ["bca", "mandiri", "bni", "bsi"] as const

export type VaBank = (typeof VA_BANKS)[number]
export type TransferBank = (typeof TRANSFER_BANKS)[number]
