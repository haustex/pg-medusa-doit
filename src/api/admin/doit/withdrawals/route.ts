import type { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { loadCredentials, modeOf, parseQuery } from "../../../../lib/admin-context"
import { DOIT_LEDGER_MODULE } from "../../../../modules/doitLedger"
import type DoitLedgerModuleService from "../../../../modules/doitLedger/service"
import { createDoitWithdrawalWorkflow } from "../../../../workflows/doit-admin"
import { type PostAdminDoitWithdrawalType, WithdrawalsQuery } from "../validators"

export async function GET(req: AuthenticatedMedusaRequest, res: MedusaResponse) {
  const query = parseQuery(WithdrawalsQuery, req.query)
  const creds = await loadCredentials(req)
  const service = req.scope.resolve(DOIT_LEDGER_MODULE) as DoitLedgerModuleService
  const [withdrawals, count] = await service.listAndCountDoitWithdrawals(
    { environment: modeOf(creds) },
    { take: query.limit, skip: query.offset, order: { date: "DESC", created_at: "DESC" } }
  )
  res.json({ withdrawals, count, limit: query.limit, offset: query.offset })
}

export async function POST(req: AuthenticatedMedusaRequest<PostAdminDoitWithdrawalType>, res: MedusaResponse) {
  const creds = await loadCredentials(req)
  const { result } = await createDoitWithdrawalWorkflow(req.scope).run({
    input: {
      ...req.validatedBody,
      environment: modeOf(creds),
      created_by: req.auth_context?.actor_id ?? null,
    },
  })
  res.json({ created: result.created })
}
