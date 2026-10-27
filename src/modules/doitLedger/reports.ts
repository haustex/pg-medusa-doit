import type { Knex } from "@medusajs/framework/mikro-orm/knex"

/**
 * Dashboard queries. Everything is aggregated in Postgres (indexes on
 * doit_payment.paid_at / doit_created_at / environment+status, doit_refund
 * status+created_at, doit_withdrawal date); only totals, one row per day and
 * one page of transactions ever leave the database.
 *
 * Day boundaries: a local date D in zone tz starts at `D::timestamp AT TIME ZONE tz`.
 */

export type Mode = "live" | "test"
/** doit.id has reported both spellings ("test" on the sandbox, "sandbox" in docs). */
export const ENVIRONMENTS_BY_MODE: Record<Mode, string[]> = {
  live: ["live", "production"],
  test: ["test", "sandbox"],
}

export type ReportRange = {
  from: string
  /** inclusive */
  to: string
  timezone: string
  mode: Mode
}

const PAID = ["paid", "refunded"]

function nextDay(date: string): string {
  const d = new Date(`${date}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + 1)
  return d.toISOString().slice(0, 10)
}

const int = (v: unknown) => Number(v ?? 0) || 0

export type DashboardStats = {
  success: { count: number; amount: number }
  pending: { count: number; amount: number }
  failed: { count: number; amount: number }
  refunds: { count: number; amount: number }
  gross: number
  fee: number
  net: number
  withdrawals: { count: number; amount: number }
  /** all time, not limited to the range */
  balance: {
    net_paid: number
    refunded: number
    withdrawn: number
    estimate: number
  }
  open_attention: number
}

export async function dashboardStats(knex: Knex, r: ReportRange): Promise<DashboardStats> {
  const envs = ENVIRONMENTS_BY_MODE[r.mode]
  const start = knex.raw("?::timestamp at time zone ?", [r.from, r.timezone])
  const end = knex.raw("?::timestamp at time zone ?", [nextDay(r.to), r.timezone])

  const [payments, refunds, withdrawals, balance, attention] = await Promise.all([
    knex("doit_payment")
      .whereNull("deleted_at")
      .whereNull("excluded_at")
      .whereIn("environment", envs)
      .select(
        knex.raw(
          `count(*) filter (where status = any(?) and paid_at >= ? and paid_at < ?) as success_count,
           coalesce(sum(amount) filter (where status = any(?) and paid_at >= ? and paid_at < ?), 0) as success_amount,
           coalesce(sum(fee_amount) filter (where status = any(?) and paid_at >= ? and paid_at < ?), 0) as fee,
           coalesce(sum(net_amount) filter (where status = any(?) and paid_at >= ? and paid_at < ?), 0) as net,
           count(*) filter (where status = 'pending' and doit_created_at >= ? and doit_created_at < ?) as pending_count,
           coalesce(sum(amount) filter (where status = 'pending' and doit_created_at >= ? and doit_created_at < ?), 0) as pending_amount,
           count(*) filter (where status in ('expired', 'failed') and doit_created_at >= ? and doit_created_at < ?) as failed_count,
           coalesce(sum(amount) filter (where status in ('expired', 'failed') and doit_created_at >= ? and doit_created_at < ?), 0) as failed_amount`,
          [
            PAID, start, end,
            PAID, start, end,
            PAID, start, end,
            PAID, start, end,
            start, end,
            start, end,
            start, end,
            start, end,
          ]
        )
      )
      .first(),
    knex("doit_refund as r")
      .join("doit_payment as p", "p.doit_id", "r.doit_payment_id")
      .whereNull("r.deleted_at")
      .whereNull("p.deleted_at")
      .whereNull("p.excluded_at")
      .where("r.status", "succeeded")
      .whereIn("p.environment", envs)
      .where("r.created_at", ">=", start)
      .where("r.created_at", "<", end)
      .select(knex.raw("count(*) as count, coalesce(sum(r.amount), 0) as amount"))
      .first(),
    knex("doit_withdrawal")
      .whereNull("deleted_at")
      .where("environment", r.mode)
      .where("date", ">=", r.from)
      .where("date", "<=", r.to)
      .select(knex.raw("count(*) as count, coalesce(sum(amount + fee_amount), 0) as amount"))
      .first(),
    knex
      .select(
        knex.raw(
          `(select coalesce(sum(net_amount), 0) from doit_payment
             where deleted_at is null and excluded_at is null and status = any(?) and environment = any(?)) as net_paid,
           (select coalesce(sum(r.amount), 0) from doit_refund r join doit_payment p on p.doit_id = r.doit_payment_id
             where r.deleted_at is null and p.deleted_at is null and p.excluded_at is null
               and r.status = 'succeeded' and p.environment = any(?)) as refunded,
           (select coalesce(sum(amount + fee_amount), 0) from doit_withdrawal
             where deleted_at is null and environment = ?) as withdrawn`,
          [PAID, envs, envs, r.mode]
        )
      )
      .first(),
    knex("doit_attention").whereNull("deleted_at").where("status", "open").count({ count: "*" }).first(),
  ])

  const p = payments as Record<string, unknown>
  const b = balance as Record<string, unknown>
  return {
    success: { count: int(p.success_count), amount: int(p.success_amount) },
    pending: { count: int(p.pending_count), amount: int(p.pending_amount) },
    failed: { count: int(p.failed_count), amount: int(p.failed_amount) },
    refunds: { count: int((refunds as any)?.count), amount: int((refunds as any)?.amount) },
    gross: int(p.success_amount),
    fee: int(p.fee),
    net: int(p.net),
    withdrawals: { count: int((withdrawals as any)?.count), amount: int((withdrawals as any)?.amount) },
    balance: {
      net_paid: int(b.net_paid),
      refunded: int(b.refunded),
      withdrawn: int(b.withdrawn),
      estimate: int(b.net_paid) - int(b.refunded) - int(b.withdrawn),
    },
    open_attention: int((attention as any)?.count),
  }
}

export type DailyPoint = { date: string; count: number; gross: number; net: number }

/** Successful payments per local day (by paid_at); days without payments are filled with zeros by the caller. */
export async function dailySeries(knex: Knex, r: ReportRange): Promise<DailyPoint[]> {
  const rows = await knex("doit_payment")
    .whereNull("deleted_at")
    .whereNull("excluded_at")
    .whereIn("environment", ENVIRONMENTS_BY_MODE[r.mode])
    .whereIn("status", PAID)
    .where("paid_at", ">=", knex.raw("?::timestamp at time zone ?", [r.from, r.timezone]))
    .where("paid_at", "<", knex.raw("?::timestamp at time zone ?", [nextDay(r.to), r.timezone]))
    .select(
      knex.raw("to_char(paid_at at time zone ?, 'YYYY-MM-DD') as date", [r.timezone]),
      knex.raw("count(*) as count"),
      knex.raw("coalesce(sum(amount), 0) as gross"),
      knex.raw("coalesce(sum(net_amount), 0) as net")
    )
    .groupByRaw("1")
    .orderByRaw("1")
  return (rows as Record<string, unknown>[]).map((row) => ({
    date: String(row.date),
    count: int(row.count),
    gross: int(row.gross),
    net: int(row.net),
  }))
}

export type PaymentFilters = {
  mode: Mode
  timezone: string
  from?: string
  to?: string
  status?: string[]
  rail?: string[]
  q?: string
  /** hide (default): leave out excluded rows · include: show them too · only: just them */
  excluded?: "hide" | "include" | "only"
}

function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (c) => `\\${c}`)
}

/** Shared WHERE for the transaction table and the CSV export (filters on doit_created_at). */
export function paymentQuery(knex: Knex, f: PaymentFilters) {
  const query = knex("doit_payment").whereNull("deleted_at")
  if (f.excluded === "only") {
    // excluded rows include payments of the other mode, so the mode filter does not apply
    query.whereNotNull("excluded_at")
  } else {
    query.where((w) => {
      w.whereIn("environment", ENVIRONMENTS_BY_MODE[f.mode]).whereNull("excluded_at")
      if (f.excluded === "include") {
        w.orWhereNotNull("excluded_at")
      }
    })
  }
  if (f.from) {
    query.where("doit_created_at", ">=", knex.raw("?::timestamp at time zone ?", [f.from, f.timezone]))
  }
  if (f.to) {
    query.where("doit_created_at", "<", knex.raw("?::timestamp at time zone ?", [nextDay(f.to), f.timezone]))
  }
  if (f.status?.length) {
    // "failed" in the UI covers both terminal non-paid states
    const statuses = f.status.flatMap((s) => (s === "failed" ? ["failed", "expired"] : [s]))
    query.whereIn("status", statuses)
  }
  if (f.rail?.length) {
    query.whereIn("rail", f.rail)
  }
  const q = f.q?.trim()
  if (q) {
    const like = `%${escapeLike(q)}%`
    query.where((w) =>
      w
        .whereRaw("reference ilike ? escape '\\'", [like])
        .orWhereRaw("order_id ilike ? escape '\\'", [like])
        .orWhereRaw("doit_id ilike ? escape '\\'", [like])
    )
  }
  return query
}

export const PAYMENT_COLUMNS = [
  "id",
  "doit_id",
  "reference",
  "session_id",
  "order_id",
  "status",
  "rail",
  "va_bank",
  "amount",
  "fee_amount",
  "net_amount",
  "total_amount",
  "fee_payer",
  "refunded_amount",
  "flags",
  "environment",
  "paid_at",
  "expires_at",
  "doit_created_at",
  "excluded_at",
  "excluded_reason",
] as const

export async function listPayments(
  knex: Knex,
  f: PaymentFilters,
  { limit, offset }: { limit: number; offset: number }
): Promise<{ payments: Record<string, unknown>[]; count: number }> {
  const [rows, total] = await Promise.all([
    paymentQuery(knex, f)
      .select(PAYMENT_COLUMNS as unknown as string[])
      .orderBy([{ column: "doit_created_at", order: "desc", nulls: "last" }, { column: "id", order: "desc" }])
      .limit(limit)
      .offset(offset),
    paymentQuery(knex, f).count({ count: "*" }).first(),
  ])
  return { payments: rows as Record<string, unknown>[], count: int((total as any)?.count) }
}
