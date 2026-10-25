import { createWorkflow, WorkflowResponse } from "@medusajs/framework/workflows-sdk"
import { saveDoitSyncStateStep, type SaveDoitSyncStateInput } from "./steps/doit-ledger"

export const saveDoitSyncStateWorkflow = createWorkflow(
  "save-doit-sync-state",
  function (input: SaveDoitSyncStateInput) {
    return new WorkflowResponse(saveDoitSyncStateStep(input))
  }
)
