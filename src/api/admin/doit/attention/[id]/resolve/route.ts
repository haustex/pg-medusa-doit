import type { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { resolveDoitAttentionWorkflow } from "../../../../../../workflows/doit-admin"
import type { PostAdminDoitAttentionResolveType } from "../../../validators"

export async function POST(req: AuthenticatedMedusaRequest<PostAdminDoitAttentionResolveType>, res: MedusaResponse) {
  const { result } = await resolveDoitAttentionWorkflow(req.scope).run({
    input: {
      id: req.params.id,
      status: req.validatedBody.status,
      note: req.validatedBody.note ?? null,
      actor_id: req.auth_context?.actor_id ?? null,
    },
  })
  res.json({ item: result })
}
