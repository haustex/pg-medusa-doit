import { createWorkflow, transform, WorkflowResponse } from "@medusajs/framework/workflows-sdk"
import type { LedgerAttentionInput, LedgerPaymentInput, LedgerRefundInput } from "../lib/ledger"
import {
  recalculateDoitRefundTotalsStep,
  saveDoitEventStep,
  type SaveDoitEventInput,
  upsertDoitAttentionsStep,
  upsertDoitPaymentsStep,
  upsertDoitRefundsStep,
} from "./steps/doit-ledger"

export type RecordDoitLedgerInput = {
  payments?: LedgerPaymentInput[]
  refunds?: LedgerRefundInput[]
  attentions?: LedgerAttentionInput[]
  resolve_attentions?: { dedupe_key: string; note: string; status?: "resolved" | "dismissed" }[]
  event?: SaveDoitEventInput
}

/**
 * Single entry point for ledger writes from the webhook subscriber, the
 * refund subscriber and the sync job. Every step is an idempotent upsert, so
 * a retried event or an overlapping sync page writes the same rows again.
 */
export const recordDoitLedgerWorkflow = createWorkflow(
  "record-doit-ledger",
  function (input: RecordDoitLedgerInput) {
    const parts = transform({ input }, ({ input }) => ({
      payments: input.payments ?? [],
      refunds: input.refunds ?? [],
      attentions: { attentions: input.attentions ?? [], resolve: input.resolve_attentions ?? [] },
      event: input.event ?? null,
    }))

    const payments = upsertDoitPaymentsStep(parts.payments)
    const refunds = upsertDoitRefundsStep(parts.refunds)
    const totals = recalculateDoitRefundTotalsStep(refunds.payment_ids)
    const attentions = upsertDoitAttentionsStep(parts.attentions)
    saveDoitEventStep(parts.event)

    return new WorkflowResponse({ payments, totals, attentions })
  }
)
