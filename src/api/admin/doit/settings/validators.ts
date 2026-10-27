import { z } from "@medusajs/framework/zod"
import { TRANSFER_BANKS, VA_BANKS } from "../../../../lib/banks"
import { isValidDate, isValidTimezone } from "../../../../lib/date-range"

export { TRANSFER_BANKS, VA_BANKS }

export const PostAdminDoitSettings = z
  .object({
    // "" or null clears the stored value; omitted keeps it
    api_key: z.string().trim().nullish(),
    webhook_secret: z.string().trim().nullish(),
    rail: z.enum(["any", "qris", "va", "transfer"]).optional(),
    va_bank: z.enum([...VA_BANKS, ...TRANSFER_BANKS]).nullish(),
    expires_in: z.number().int().min(60).optional(),
    timezone: z
      .string()
      .refine(isValidTimezone, { message: "timezone harus nama zona IANA, mis. Asia/Jakarta" })
      .optional(),
    // shown in doit.id's reference before the session id, e.g. "HK-"; "" or null removes it
    reference_prefix: z
      .string()
      .trim()
      .regex(/^([A-Za-z0-9][A-Za-z0-9_-]{0,15})?$/, {
        message: "reference_prefix: huruf, angka, - atau _, maksimal 16 karakter, diawali huruf/angka",
      })
      .nullish(),
    // YYYY-MM-DD in the dashboard time zone; null clears it (back to the default)
    ignore_before: z
      .string()
      .refine(isValidDate, { message: "ignore_before harus tanggal YYYY-MM-DD" })
      .nullish(),
  })
  .refine((v) => v.rail !== "va" || v.va_bank === undefined || (VA_BANKS as readonly string[]).includes(v.va_bank ?? ""), {
    message: "va_bank harus salah satu kode VA (bmri, bnia, brin, cimb, permata, maybank, danamon, bsyi)",
    path: ["va_bank"],
  })
  .refine(
    (v) => v.rail !== "transfer" || v.va_bank === undefined || (TRANSFER_BANKS as readonly string[]).includes(v.va_bank ?? ""),
    {
      message: "Untuk rail transfer, va_bank harus bca, mandiri, bni, atau bsi",
      path: ["va_bank"],
    }
  )

export type PostAdminDoitSettingsType = z.infer<typeof PostAdminDoitSettings>
