import type { IOrderModuleService } from "@medusajs/framework/types"
import { Modules } from "@medusajs/framework/utils"
import { createStep, StepResponse } from "@medusajs/framework/workflows-sdk"
import type { DoitOrderNote } from "../../lib/order-note"

export type AnnotateDoitOrderInput = { order_id: string; note: DoitOrderNote }

/** Merges `metadata.doit` into the order; compensation restores the previous metadata. */
export const annotateDoitOrderStep = createStep(
  "annotate-doit-order",
  async (input: AnnotateDoitOrderInput, { container }) => {
    const orders = container.resolve<IOrderModuleService>(Modules.ORDER)
    const order = await orders.retrieveOrder(input.order_id, { select: ["id", "metadata"] })
    const previous = (order.metadata ?? null) as Record<string, unknown> | null
    await orders.updateOrders(input.order_id, { metadata: { ...(previous ?? {}), doit: input.note } })
    return new StepResponse(input.note, { id: input.order_id, previous })
  },
  async (undo, { container }) => {
    if (!undo) {
      return
    }
    const orders = container.resolve<IOrderModuleService>(Modules.ORDER)
    await orders.updateOrders(undo.id, { metadata: undo.previous ?? {} })
  }
)
