import type { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { deleteDoitWithdrawalWorkflow } from "../../../../../workflows/doit-admin"

export async function DELETE(req: AuthenticatedMedusaRequest, res: MedusaResponse) {
  await deleteDoitWithdrawalWorkflow(req.scope).run({ input: { id: req.params.id } })
  res.json({ id: req.params.id, object: "doit_withdrawal", deleted: true })
}
