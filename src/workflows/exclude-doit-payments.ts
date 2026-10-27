import { createWorkflow, WorkflowResponse } from "@medusajs/framework/workflows-sdk"
import { excludeDoitPaymentsStep, type ExcludeDoitPaymentsInput } from "./steps/doit-ledger"

/** Marks ledger rows that are not this store's payments as excluded (never deletes them). */
export const excludeDoitPaymentsWorkflow = createWorkflow(
  "exclude-doit-payments",
  function (input: ExcludeDoitPaymentsInput) {
    return new WorkflowResponse(excludeDoitPaymentsStep(input))
  }
)
