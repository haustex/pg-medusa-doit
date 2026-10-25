import { z } from "@medusajs/framework/zod"
import { RANGE_PRESETS } from "../../../lib/date-range"
import { MAX_CSV_BYTES } from "../../../lib/settlement-csv"

const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "format YYYY-MM-DD")
const list = z
  .union([z.string(), z.array(z.string())])
  .transform((v) => (Array.isArray(v) ? v : v.split(",")).map((s) => s.trim()).filter(Boolean))

// ---- query (parsed in the routes with parseQuery)

export const RangeQuery = z.object({
  preset: z.enum(RANGE_PRESETS).default("7d"),
  from: date.optional(),
  to: date.optional(),
})

const page = {
  limit: z.coerce.number().int().min(1).max(100).default(20),
  offset: z.coerce.number().int().min(0).default(0),
}

export const PaymentsQuery = RangeQuery.extend({
  status: list.pipe(z.array(z.enum(["paid", "pending", "failed", "expired", "refunded"]))).optional(),
  rail: list.pipe(z.array(z.enum(["qris", "va", "transfer", "any"]))).optional(),
  q: z.string().trim().max(128).optional(),
  ...page,
})

export const AttentionQuery = z.object({
  status: z.enum(["open", "resolved", "dismissed", "all"]).default("open"),
  ...page,
})

export const WithdrawalsQuery = z.object(page)

// ---- bodies (validateAndTransformBody in middlewares.ts)

export const PostAdminDoitTestConnection = z.object({
  // test a key before saving it; omitted → the key in use
  api_key: z.string().trim().regex(/^pb_(test|live)_\S+$/, "API key harus diawali pb_test_ atau pb_live_").optional(),
})
export type PostAdminDoitTestConnectionType = z.infer<typeof PostAdminDoitTestConnection>

export const PostAdminDoitWithdrawal = z.object({
  date,
  amount: z.number().int().positive(),
  fee_amount: z.number().int().min(0).optional(),
  note: z.string().trim().max(500).nullish(),
})
export type PostAdminDoitWithdrawalType = z.infer<typeof PostAdminDoitWithdrawal>

export const PostAdminDoitSettlementImport = z.object({
  csv: z.string().min(1).max(MAX_CSV_BYTES),
  dry_run: z.boolean().default(true),
})
export type PostAdminDoitSettlementImportType = z.infer<typeof PostAdminDoitSettlementImport>

export const PostAdminDoitAttentionResolve = z.object({
  status: z.enum(["resolved", "dismissed"]).default("resolved"),
  note: z.string().trim().max(1000).nullish(),
})
export type PostAdminDoitAttentionResolveType = z.infer<typeof PostAdminDoitAttentionResolve>
