import { createWorkflow, WorkflowResponse } from "@medusajs/framework/workflows-sdk"
import { annotateDoitOrderStep, type AnnotateDoitOrderInput } from "./steps/annotate-doit-order"

/** Writes the doit.id payment details (method, fee, who paid it) to `order.metadata.doit`. */
export const annotateDoitOrderWorkflow = createWorkflow(
  "annotate-doit-order",
  function (input: AnnotateDoitOrderInput) {
    return new WorkflowResponse(annotateDoitOrderStep(input))
  }
)
