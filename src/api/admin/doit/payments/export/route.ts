import type { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { loadCredentials, modeOf, parseQuery } from "../../../../../lib/admin-context"
import { toCsv } from "../../../../../lib/csv-export"
import { resolveRange } from "../../../../../lib/date-range"
import { DOIT_LEDGER_MODULE } from "../../../../../modules/doitLedger"
import type DoitLedgerModuleService from "../../../../../modules/doitLedger/service"
import { PaymentsQuery } from "../../validators"

const BATCH = 1000
export const MAX_EXPORT_ROWS = 50_000

/** CSV of the filtered transactions, read in batches of 1 000 rows. */
export async function GET(req: AuthenticatedMedusaRequest, res: MedusaResponse) {
  const query = parseQuery(PaymentsQuery, req.query)
  const creds = await loadCredentials(req)
  const range = resolveRange({ ...query, timezone: creds.timezone })
  const service = req.scope.resolve(DOIT_LEDGER_MODULE) as DoitLedgerModuleService
  const filters = {
    mode: modeOf(creds),
    timezone: range.timezone,
    from: range.from,
    to: range.to,
    status: query.status,
    rail: query.rail,
    q: query.q,
    excluded: query.excluded,
  }

  const rows: Record<string, unknown>[] = []
  for (let offset = 0; offset < MAX_EXPORT_ROWS; offset += BATCH) {
    const { payments } = await service.listPaymentsPage(filters, { limit: BATCH, offset })
    rows.push(...payments)
    if (payments.length < BATCH) break
  }

  const filename = `doit-transaksi-${range.from}_${range.to}.csv`
  res.setHeader("Content-Type", "text/csv; charset=utf-8")
  res.setHeader("Content-Disposition", `attachment; filename="${filename}"`)
  res.send(toCsv(rows, range.timezone))
}
