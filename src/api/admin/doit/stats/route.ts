import type { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { loadCredentials, modeOf, parseQuery } from "../../../../lib/admin-context"
import { eachDay, resolveRange } from "../../../../lib/date-range"
import { DOIT_LEDGER_MODULE } from "../../../../modules/doitLedger"
import type DoitLedgerModuleService from "../../../../modules/doitLedger/service"
import { RangeQuery } from "../validators"

/** Cards and the daily chart; all totals are computed in SQL. */
export async function GET(req: AuthenticatedMedusaRequest, res: MedusaResponse) {
  const query = parseQuery(RangeQuery, req.query)
  const creds = await loadCredentials(req)
  const range = resolveRange({ ...query, timezone: creds.timezone })
  const mode = modeOf(creds)
  const service = req.scope.resolve(DOIT_LEDGER_MODULE) as DoitLedgerModuleService

  const reportRange = { from: range.from, to: range.to, timezone: range.timezone, mode }
  const [stats, points] = await Promise.all([
    service.getDashboardStats(reportRange),
    service.getDailySeries(reportRange),
  ])
  const byDate = new Map(points.map((p) => [p.date, p]))
  res.json({
    range,
    mode,
    stats,
    series: eachDay(range.from, range.to).map((date) => byDate.get(date) ?? { date, count: 0, gross: 0, net: 0 }),
  })
}
