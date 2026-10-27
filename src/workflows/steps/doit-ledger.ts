import { MedusaError } from "@medusajs/framework/utils"
import { createStep, StepResponse } from "@medusajs/framework/workflows-sdk"
import {
  classifyRedelivery,
  type LedgerAttentionInput,
  type LedgerPaymentInput,
  type LedgerRefundInput,
} from "../../lib/ledger"
import { DOIT_LEDGER_MODULE } from "../../modules/doitLedger"
import type DoitLedgerModuleService from "../../modules/doitLedger/service"

type Row = Record<string, any> & { id: string }

/** Drops columns managed by the ORM so a snapshot can be written back. */
function restorable(row: Row): Row {
  const { created_at, updated_at, deleted_at, ...rest } = row
  return rest as Row
}

function ledger(container: { resolve: (key: string) => unknown }): DoitLedgerModuleService {
  return container.resolve(DOIT_LEDGER_MODULE) as DoitLedgerModuleService
}

function isUniqueViolation(e: unknown): boolean {
  const err = e as { type?: string; code?: string; message?: string }
  return (
    err?.type === MedusaError.Types.DUPLICATE_ERROR ||
    err?.code === "23505" ||
    /already exists|duplicate key|unique/i.test(err?.message ?? "")
  )
}

type Compensation = { created: string[]; previous: Row[] }

// ---------------------------------------------------------------- events

export type ClaimDoitEventInput = {
  event_id: string
  type: string
  doit_payment_id: string | null
  payload: Record<string, unknown> | null
}

/**
 * Claims a webhook delivery before it is queued. The unique event_id makes
 * this safe across server instances: only one delivery creates the row.
 */
export const claimDoitEventStep = createStep(
  "claim-doit-event",
  async (input: ClaimDoitEventInput, { container }) => {
    const service = ledger(container)
    const now = new Date()
    try {
      const created = await service.createDoitEvents({
        ...input,
        status: "received",
        attempts: 0,
        received_at: now,
      })
      return new StepResponse({ duplicate: false, id: created.id }, { created: [created.id], previous: [] } as Compensation)
    } catch (e) {
      if (!isUniqueViolation(e)) {
        throw e
      }
    }

    const [existing] = await service.listDoitEvents({ event_id: input.event_id }, { take: 1 })
    if (!existing) {
      // Lost a race with a delete; treat as new delivery.
      return new StepResponse({ duplicate: false, id: null as string | null }, { created: [], previous: [] } as Compensation)
    }
    if (classifyRedelivery(existing as never, now.getTime()) === "duplicate") {
      return new StepResponse({ duplicate: true, id: existing.id }, { created: [], previous: [] } as Compensation)
    }
    await service.updateDoitEvents({
      id: existing.id,
      status: "received",
      attempts: 0,
      last_error: null,
      received_at: now,
    })
    return new StepResponse(
      { duplicate: false, id: existing.id },
      { created: [], previous: [restorable(existing as Row)] } as Compensation
    )
  },
  async (comp, { container }) => {
    if (!comp) return
    const service = ledger(container)
    if (comp.created.length) await service.deleteDoitEvents(comp.created)
    for (const row of comp.previous) await service.updateDoitEvents(row as never)
  }
)

export type SaveDoitEventInput = {
  event_id: string
  type: string
  doit_payment_id?: string | null
  status: "received" | "processed" | "ignored" | "failed"
  attempts: number
  last_error?: string | null
  processed_at?: Date | null
  payload?: Record<string, unknown> | null
} | null

export const saveDoitEventStep = createStep(
  "save-doit-event",
  async (input: SaveDoitEventInput, { container }) => {
    if (!input) {
      return new StepResponse(null, { created: [], previous: [] } as Compensation)
    }
    const service = ledger(container)
    const [existing] = await service.listDoitEvents({ event_id: input.event_id }, { take: 1 })
    if (existing) {
      const { payload, ...rest } = input
      await service.updateDoitEvents({ id: existing.id, ...rest, ...(existing.payload ? {} : { payload }) })
      return new StepResponse(existing.id, { created: [], previous: [restorable(existing as Row)] } as Compensation)
    }
    const created = await service.createDoitEvents({ ...input, received_at: new Date() })
    return new StepResponse(created.id, { created: [created.id], previous: [] } as Compensation)
  },
  async (comp, { container }) => {
    if (!comp) return
    const service = ledger(container)
    if (comp.created.length) await service.deleteDoitEvents(comp.created)
    for (const row of comp.previous) await service.updateDoitEvents(row as never)
  }
)

// ---------------------------------------------------------------- payments

const STATUS_RANK: Record<string, number> = { pending: 0, expired: 1, failed: 1, paid: 2, refunded: 3 }

/**
 * A redelivered or stale snapshot must not move a payment backwards
 * (e.g. an old payment.expired arriving after payment.paid).
 */
export function mergeStatus(current: string | undefined, incoming: string): string {
  if (!current) return incoming
  return (STATUS_RANK[incoming] ?? 0) >= (STATUS_RANK[current] ?? 0) ? incoming : current
}

export const upsertDoitPaymentsStep = createStep(
  "upsert-doit-payments",
  async (input: LedgerPaymentInput[], { container }) => {
    const comp: Compensation = { created: [], previous: [] }
    if (!input.length) {
      return new StepResponse([] as Row[], comp)
    }
    const service = ledger(container)
    const existing = await service.listDoitPayments({ doit_id: input.map((p) => p.doit_id) })
    const byDoitId = new Map(existing.map((p) => [p.doit_id, p as Row]))
    const saved: Row[] = []

    for (const { authoritative, ...p } of input) {
      const current = byDoitId.get(p.doit_id)
      if (!current) {
        const created = await service.createDoitPayments({ ...p, flags: p.flags as never, raw: p.raw as never })
        comp.created.push(created.id)
        byDoitId.set(p.doit_id, created as Row)
        saved.push(created as Row)
        continue
      }
      const flags = Array.from(new Set([...((current.flags as string[]) ?? []), ...p.flags]))
      const status = authoritative ? p.status : mergeStatus(current.status, p.status)
      const update: Record<string, unknown> = {
        ...p,
        status,
        flags,
        // keep values a partial snapshot does not know about
        session_id: p.session_id ?? current.session_id,
        order_id: p.order_id ?? current.order_id,
        reconciled_at: p.reconciled_at ?? current.reconciled_at,
        paid_at: p.paid_at ?? current.paid_at,
        raw: status === p.status ? p.raw : current.raw,
      }
      comp.previous.push(restorable(current))
      const updated = await service.updateDoitPayments({ id: current.id, ...update } as never)
      saved.push(updated as Row)
    }
    return new StepResponse(saved, comp)
  },
  async (comp, { container }) => {
    if (!comp) return
    const service = ledger(container)
    if (comp.created.length) await service.deleteDoitPayments(comp.created)
    for (const row of comp.previous) await service.updateDoitPayments(row as never)
  }
)

// ---------------------------------------------------------------- refunds

export const upsertDoitRefundsStep = createStep(
  "upsert-doit-refunds",
  async (input: LedgerRefundInput[], { container }) => {
    const comp: Compensation = { created: [], previous: [] }
    const paymentIds = new Set<string>()
    const service = ledger(container)

    for (const r of input) {
      paymentIds.add(r.doit_payment_id)
      let current: Row | undefined
      if (r.doit_refund_id) {
        current = (await service.listDoitRefunds({ doit_refund_id: r.doit_refund_id }, { take: 1 }))[0] as Row
      }
      if (!current && r.medusa_refund_id) {
        current = (await service.listDoitRefunds({ medusa_refund_id: r.medusa_refund_id }, { take: 1 }))[0] as Row
      }
      if (!current && !r.doit_refund_id && r.source === "webhook") {
        // A webhook without a refund id: match an API refund of the same amount not yet confirmed.
        const candidates = await service.listDoitRefunds({
          doit_payment_id: r.doit_payment_id,
          amount: r.amount,
          webhook_event_id: null,
        })
        current = candidates[0] as Row | undefined
      }

      if (!current) {
        const created = await service.createDoitRefunds({ ...r, raw: r.raw as never })
        comp.created.push(created.id)
        continue
      }
      comp.previous.push(restorable(current))
      await service.updateDoitRefunds({
        id: current.id,
        doit_refund_id: current.doit_refund_id ?? r.doit_refund_id,
        medusa_refund_id: current.medusa_refund_id ?? r.medusa_refund_id,
        // a webhook result is final; an API answer never downgrades it
        status: r.source === "webhook" || current.status === "pending" ? r.status : current.status,
        reason: r.reason ?? current.reason,
        webhook_event_id: r.webhook_event_id ?? current.webhook_event_id,
        amount: current.amount ?? r.amount,
      } as never)
    }
    return new StepResponse({ payment_ids: [...paymentIds] }, comp)
  },
  async (comp, { container }) => {
    if (!comp) return
    const service = ledger(container)
    if (comp.created.length) await service.deleteDoitRefunds(comp.created)
    for (const row of comp.previous) await service.updateDoitRefunds(row as never)
  }
)

export type RefundTotal = {
  doit_id: string
  amount: number
  refunded_amount: number
  session_id: string | null
  order_id: string | null
}

/** doit_payment.refunded_amount = sum of succeeded refunds in the ledger. */
export const recalculateDoitRefundTotalsStep = createStep(
  "recalculate-doit-refund-totals",
  async (paymentIds: string[], { container }) => {
    const comp: Compensation = { created: [], previous: [] }
    const totals: RefundTotal[] = []
    if (!paymentIds.length) {
      return new StepResponse(totals, comp)
    }
    const service = ledger(container)
    const payments = await service.listDoitPayments({ doit_id: paymentIds })
    for (const p of payments) {
      const refunds = await service.listDoitRefunds({ doit_payment_id: p.doit_id, status: "succeeded" })
      const refunded = refunds.reduce((sum, r) => sum + Number(r.amount), 0)
      if (refunded !== Number(p.refunded_amount)) {
        comp.previous.push(restorable(p as Row))
        await service.updateDoitPayments({ id: p.id, refunded_amount: refunded })
      }
      totals.push({
        doit_id: p.doit_id,
        amount: Number(p.amount),
        refunded_amount: refunded,
        session_id: p.session_id,
        order_id: p.order_id,
      })
    }
    return new StepResponse(totals, comp)
  },
  async (comp, { container }) => {
    if (!comp) return
    const service = ledger(container)
    for (const row of comp.previous) await service.updateDoitPayments(row as never)
  }
)

// ---------------------------------------------------------------- attention

export type UpsertDoitAttentionsInput = {
  attentions: LedgerAttentionInput[]
  /** dedupe keys of open items to close automatically (default status "resolved") */
  resolve: { dedupe_key: string; note: string; status?: "resolved" | "dismissed" }[]
}

/**
 * One item per dedupe_key: an open item is refreshed, a resolved or
 * dismissed one is left alone (a person already decided).
 */
export const upsertDoitAttentionsStep = createStep(
  "upsert-doit-attentions",
  async (input: UpsertDoitAttentionsInput, { container }) => {
    const comp: Compensation = { created: [], previous: [] }
    const service = ledger(container)
    const created: string[] = []

    for (const a of input.attentions) {
      const [current] = await service.listDoitAttentions({ dedupe_key: a.dedupe_key }, { take: 1 })
      if (!current) {
        const row = await service.createDoitAttentions({ ...a, details: (a.details ?? null) as never })
        comp.created.push(row.id)
        created.push(row.id)
        continue
      }
      if (current.status === "open") {
        comp.previous.push(restorable(current as Row))
        await service.updateDoitAttentions({
          id: current.id,
          message: a.message,
          amount: a.amount ?? current.amount,
          order_id: a.order_id ?? current.order_id,
          details: (a.details ?? current.details) as never,
        })
      }
    }

    for (const r of input.resolve) {
      const [current] = await service.listDoitAttentions({ dedupe_key: r.dedupe_key, status: "open" }, { take: 1 })
      if (current) {
        comp.previous.push(restorable(current as Row))
        await service.updateDoitAttentions({
          id: current.id,
          status: r.status ?? "resolved",
          resolved_at: new Date(),
          resolved_by: "system",
          resolution_note: r.note,
        })
      }
    }
    return new StepResponse({ created }, comp)
  },
  async (comp, { container }) => {
    if (!comp) return
    const service = ledger(container)
    if (comp.created.length) await service.deleteDoitAttentions(comp.created)
    for (const row of comp.previous) await service.updateDoitAttentions(row as never)
  }
)

// ---------------------------------------------------------------- sync state

export type SaveDoitSyncStateInput = {
  key: string
  cursor?: Date | null
  last_run_at?: Date
  last_success_at?: Date
  last_error?: string | null
  stats?: Record<string, unknown> | null
}

export const saveDoitSyncStateStep = createStep(
  "save-doit-sync-state",
  async (input: SaveDoitSyncStateInput, { container }) => {
    const service = ledger(container)
    const [current] = await service.listDoitSyncStates({ key: input.key }, { take: 1 })
    if (!current) {
      const created = await service.createDoitSyncStates({ ...input, stats: (input.stats ?? null) as never })
      return new StepResponse(created.id, { created: [created.id], previous: [] } as Compensation)
    }
    await service.updateDoitSyncStates({ id: current.id, ...input, stats: (input.stats ?? current.stats) as never })
    return new StepResponse(current.id, { created: [], previous: [restorable(current as Row)] } as Compensation)
  },
  async (comp, { container }) => {
    if (!comp) return
    const service = ledger(container)
    if (comp.created.length) await service.deleteDoitSyncStates(comp.created)
    for (const row of comp.previous) await service.updateDoitSyncStates(row as never)
  }
)

// ---------------------------------------------------------------- exclusion

export type ExcludeDoitPaymentsInput = { exclusions: { doit_id: string; reason: string }[] }

/**
 * Marks ledger rows as not this store's (excluded_at + reason). Rows are kept,
 * only left out of the dashboard and reconciliation; already excluded rows are
 * left as they are. Compensation clears the marks it set.
 */
export const excludeDoitPaymentsStep = createStep(
  "exclude-doit-payments",
  async (input: ExcludeDoitPaymentsInput, { container }) => {
    const service = ledger(container)
    const marked: string[] = []
    const now = new Date()
    for (const { doit_id, reason } of input.exclusions) {
      const [row] = await service.listDoitPayments({ doit_id, excluded_at: null } as never, { take: 1 })
      if (!row) continue
      await service.updateDoitPayments({ id: row.id, excluded_at: now, excluded_reason: reason })
      marked.push(row.id)
    }
    return new StepResponse({ excluded: marked.length }, marked)
  },
  async (marked, { container }) => {
    if (!marked?.length) return
    const service = ledger(container)
    for (const id of marked) await service.updateDoitPayments({ id, excluded_at: null, excluded_reason: null })
  }
)
