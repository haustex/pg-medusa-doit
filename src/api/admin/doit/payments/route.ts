import type { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { loadCredentials, modeOf, parseQuery } from "../../../../lib/admin-context"
import { resolveRange } from "../../../../lib/date-range"
import { DOIT_LEDGER_MODULE } from "../../../../modules/doitLedger"
import type DoitLedgerModuleService from "../../../../modules/doitLedger/service"
import { PaymentsQuery } from "../validators"

/** One page of ledger payments (filtered and paginated in SQL). */
export async function GET(req: AuthenticatedMedusaRequest, res: MedusaResponse) {
  const query = parseQuery(PaymentsQuery, req.query)
  const creds = await loadCredentials(req)
  const range = resolveRange({ ...query, timezone: creds.timezone })
  const service = req.scope.resolve(DOIT_LEDGER_MODULE) as DoitLedgerModuleService
  const { payments, count } = await service.listPaymentsPage(
    {
      mode: modeOf(creds),
      timezone: range.timezone,
      from: range.from,
      to: range.to,
      status: query.status,
      rail: query.rail,
      q: query.q,
      excluded: query.excluded,
    },
    { limit: query.limit, offset: query.offset }
  )
  res.json({ payments, count, limit: query.limit, offset: query.offset, range })
}
