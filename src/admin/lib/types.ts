export type Mode = "live" | "test"

export type PublicSettings = {
  configured: boolean
  credential_source: "admin" | "options" | "env" | "none"
  environment: "sandbox" | "production" | null
  api_key: { is_set: boolean; masked: string | null }
  webhook_secret: { is_set: boolean; masked: string | null }
  rail: "any" | "qris" | "va" | "transfer"
  va_bank: string | null
  expires_in: number
  timezone: string
  encryption: { status: "ok" | "unused" | "missing" | "malformed" | "mismatch"; message: string | null }
  webhook_path: string
  webhook_url: string | null
  show_credit: boolean
  reconciliation: {
    store_id: string | null
    reference_prefix: string
    ignore_before: string | null
    ignore_before_source: "setting" | "credentials_saved" | null
    credentials_saved_at: string | null
  }
}

export type RangeParams = { preset: "today" | "7d" | "month" | "custom"; from?: string; to?: string }

export type CountAmount = { count: number; amount: number }

export type StatsResponse = {
  range: { preset: string; from: string; to: string; timezone: string }
  mode: Mode
  stats: {
    success: CountAmount
    pending: CountAmount
    failed: CountAmount
    refunds: CountAmount
    gross: number
    fee: number
    net: number
    withdrawals: CountAmount
    balance: { net_paid: number; refunded: number; withdrawn: number; estimate: number }
    open_attention: number
  }
  series: { date: string; count: number; gross: number; net: number }[]
}

export type LedgerPayment = {
  id: string
  doit_id: string
  reference: string
  session_id: string | null
  order_id: string | null
  status: string
  rail: string | null
  va_bank: string | null
  amount: number
  fee_amount: number
  net_amount: number
  total_amount: number | null
  fee_payer: string | null
  refunded_amount: number
  flags: string[] | null
  environment: string | null
  paid_at: string | null
  expires_at: string | null
  doit_created_at: string | null
}

export type Withdrawal = {
  id: string
  date: string
  amount: number
  fee_amount: number
  note: string | null
  source: "manual" | "csv"
  external_ref: string | null
  created_at: string
}

export type Attention = {
  id: string
  code: string
  status: "open" | "resolved" | "dismissed"
  doit_payment_id: string | null
  session_id: string | null
  order_id: string | null
  event_id: string | null
  amount: number | null
  message: string
  resolved_at: string | null
  resolved_by: string | null
  resolution_note: string | null
  created_at: string
}

export type ImportSummary = {
  dry_run: boolean
  columns: Record<string, string>
  total_rows: number
  new_rows: number
  duplicate_rows: number
  new_amount: number
  skipped: { line: number; reason: string }[]
  errors: { line: number; message: string }[]
  preview: { line: number; date: string; amount: number; fee_amount: number; note: string | null; duplicate: boolean }[]
  created?: number
}

export type TestConnectionResult =
  | {
      ok: true
      latency_ms: number
      key_mode: Mode
      environment: string | null
      mode_mismatch: boolean
      methods: { code: string; label: string; rail: string; bank: string | null }[]
    }
  | { ok: false; latency_ms: number; key_mode: Mode; error: { status: number; code: string; message: string } }
