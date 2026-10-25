import { z } from "@medusajs/framework/zod"
import { TRANSFER_BANKS, VA_BANKS } from "../../../../lib/banks"
import { isValidTimezone } from "../../../../lib/date-range"

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
