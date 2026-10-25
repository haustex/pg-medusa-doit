import { z } from "@medusajs/framework/zod"

export const GetStoreDoitMethods = z.object({
  cart_id: z.string().max(64).optional(),
  provider_id: z.string().max(64).optional(),
})
export type GetStoreDoitMethodsType = z.infer<typeof GetStoreDoitMethods>
