import { z } from "@medusajs/framework/zod"

export const VA_BANKS = ["bmri", "bnia", "brin", "cimb", "permata", "maybank", "danamon", "bsyi"] as const
export const TRANSFER_BANKS = ["bca", "mandiri", "bni", "bsi"] as const

export const PostAdminDoitSettings = z
  .object({
    // "" or null clears the stored value; omitted keeps it
    api_key: z.string().trim().nullish(),
    webhook_secret: z.string().trim().nullish(),
    rail: z.enum(["any", "qris", "va", "transfer"]).optional(),
    va_bank: z.enum([...VA_BANKS, ...TRANSFER_BANKS]).nullish(),
    expires_in: z.number().int().min(60).optional(),
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
