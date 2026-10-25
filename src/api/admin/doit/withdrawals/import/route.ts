import type { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { MedusaError } from "@medusajs/framework/utils"
import { loadCredentials, modeOf } from "../../../../../lib/admin-context"
import { parseSettlementCsv } from "../../../../../lib/settlement-csv"
import { DOIT_LEDGER_MODULE } from "../../../../../modules/doitLedger"
import type DoitLedgerModuleService from "../../../../../modules/doitLedger/service"
import { importDoitSettlementWorkflow } from "../../../../../workflows/doit-admin"
import type { PostAdminDoitSettlementImportType } from "../../validators"

const PREVIEW_ROWS = 50

/**
 * Settlement CSV from the doit.id portal. dry_run (default) only parses and
 * reports what would be imported; rows already imported are skipped.
 */
export async function POST(req: AuthenticatedMedusaRequest<PostAdminDoitSettlementImportType>, res: MedusaResponse) {
  const creds = await loadCredentials(req)
  const parsed = parseSettlementCsv(req.validatedBody.csv, { timezone: creds.timezone })
  const service = req.scope.resolve(DOIT_LEDGER_MODULE) as DoitLedgerModuleService
  const refs = parsed.rows.map((r) => r.external_ref)
  const existing = refs.length ? await service.listDoitWithdrawals({ external_ref: refs }) : []
  const known = new Set(existing.map((w) => w.external_ref))
  const fresh = parsed.rows.filter((r) => !known.has(r.external_ref))
  const summary = {
    columns: parsed.columns,
    total_rows: parsed.rows.length,
    new_rows: fresh.length,
    duplicate_rows: parsed.rows.length - fresh.length,
    new_amount: fresh.reduce((s, r) => s + r.amount + r.fee_amount, 0),
    skipped: parsed.skipped,
    errors: parsed.errors,
    preview: parsed.rows.slice(0, PREVIEW_ROWS).map((r) => ({
      line: r.line,
      date: r.date,
      amount: r.amount,
      fee_amount: r.fee_amount,
      note: r.note,
      duplicate: known.has(r.external_ref),
    })),
  }

  if (req.validatedBody.dry_run) {
    res.json({ dry_run: true, ...summary })
    return
  }
  if (!fresh.length) {
    throw new MedusaError(MedusaError.Types.INVALID_DATA, "Tidak ada baris baru untuk diimport.")
  }
  const { result } = await importDoitSettlementWorkflow(req.scope).run({
    input: {
      rows: fresh.map((r) => ({
        date: r.date,
        amount: r.amount,
        fee_amount: r.fee_amount,
        note: r.note,
        source: "csv" as const,
        external_ref: r.external_ref,
        environment: modeOf(creds),
        created_by: req.auth_context?.actor_id ?? null,
        raw: r.raw,
      })),
    },
  })
  res.json({ dry_run: false, ...summary, created: result.created.length, skipped_existing: result.skipped })
}
