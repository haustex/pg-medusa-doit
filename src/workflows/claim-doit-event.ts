import { createWorkflow, WorkflowResponse } from "@medusajs/framework/workflows-sdk"
import { claimDoitEventStep, type ClaimDoitEventInput } from "./steps/doit-ledger"

/** Used by the webhook middleware: `duplicate: true` means answer 200 and do not queue. */
export const claimDoitEventWorkflow = createWorkflow(
  "claim-doit-event",
  function (input: ClaimDoitEventInput) {
    return new WorkflowResponse(claimDoitEventStep(input))
  }
)
