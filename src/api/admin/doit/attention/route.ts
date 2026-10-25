import type { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { parseQuery } from "../../../../lib/admin-context"
import { DOIT_LEDGER_MODULE } from "../../../../modules/doitLedger"
import type DoitLedgerModuleService from "../../../../modules/doitLedger/service"
import { AttentionQuery } from "../validators"

/** "Perlu tindakan" items, newest first. */
export async function GET(req: AuthenticatedMedusaRequest, res: MedusaResponse) {
  const query = parseQuery(AttentionQuery, req.query)
  const service = req.scope.resolve(DOIT_LEDGER_MODULE) as DoitLedgerModuleService
  const [items, count] = await service.listAndCountDoitAttentions(
    query.status === "all" ? {} : { status: query.status },
    { take: query.limit, skip: query.offset, order: { created_at: "DESC" } }
  )
  res.json({ items, count, limit: query.limit, offset: query.offset })
}
