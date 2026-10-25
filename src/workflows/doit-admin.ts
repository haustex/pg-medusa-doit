import { createWorkflow, transform, WorkflowResponse } from "@medusajs/framework/workflows-sdk"
import {
  createDoitWithdrawalsStep,
  deleteDoitWithdrawalStep,
  resolveDoitAttentionStep,
  type ResolveAttentionInput,
  type WithdrawalInput,
} from "./steps/doit-admin"

export const createDoitWithdrawalWorkflow = createWorkflow(
  "create-doit-withdrawal",
  function (input: Omit<WithdrawalInput, "source">) {
    const rows = transform({ input }, ({ input }) => [{ ...input, source: "manual" as const }])
    return new WorkflowResponse(createDoitWithdrawalsStep(rows))
  }
)

/** Settlement CSV rows (already parsed); rows imported before are skipped by external_ref. */
export const importDoitSettlementWorkflow = createWorkflow(
  "import-doit-settlement",
  function (input: { rows: WithdrawalInput[] }) {
    const rows = transform({ input }, ({ input }) => input.rows)
    return new WorkflowResponse(createDoitWithdrawalsStep(rows))
  }
)

export const deleteDoitWithdrawalWorkflow = createWorkflow(
  "delete-doit-withdrawal",
  function (input: { id: string }) {
    const id = transform({ input }, ({ input }) => input.id)
    return new WorkflowResponse(deleteDoitWithdrawalStep(id))
  }
)

export const resolveDoitAttentionWorkflow = createWorkflow(
  "resolve-doit-attention",
  function (input: ResolveAttentionInput) {
    return new WorkflowResponse(resolveDoitAttentionStep(input))
  }
)
