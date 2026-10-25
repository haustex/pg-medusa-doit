import { MedusaError } from "@medusajs/framework/utils"
import { createStep, StepResponse } from "@medusajs/framework/workflows-sdk"
import { isValidDate } from "../../lib/date-range"
import { DOIT_LEDGER_MODULE } from "../../modules/doitLedger"
import type DoitLedgerModuleService from "../../modules/doitLedger/service"

type Row = Record<string, any> & { id: string }

function ledger(container: { resolve: (key: string) => unknown }): DoitLedgerModuleService {
  return container.resolve(DOIT_LEDGER_MODULE) as DoitLedgerModuleService
}

function restorable(row: Row): Row {
  const { created_at, updated_at, deleted_at, ...rest } = row
  return rest as Row
}

export type WithdrawalInput = {
  date: string
  amount: number
  fee_amount?: number
  note?: string | null
  source: "manual" | "csv"
  external_ref?: string | null
  environment: "live" | "test"
  created_by?: string | null
  raw?: Record<string, unknown> | null
}

function validate(w: WithdrawalInput, label = "") {
  if (!isValidDate(w.date)) {
    throw new MedusaError(MedusaError.Types.INVALID_DATA, `${label}Tanggal harus YYYY-MM-DD.`)
  }
  if (!Number.isSafeInteger(w.amount) || w.amount <= 0) {
    throw new MedusaError(MedusaError.Types.INVALID_DATA, `${label}Nominal harus rupiah utuh lebih dari 0.`)
  }
  if (w.fee_amount !== undefined && (!Number.isSafeInteger(w.fee_amount) || w.fee_amount < 0)) {
    throw new MedusaError(MedusaError.Types.INVALID_DATA, `${label}Biaya harus rupiah utuh, 0 atau lebih.`)
  }
}

/**
 * Creates withdrawals, skipping rows whose external_ref is already recorded
 * (a settlement CSV imported twice). Returns what was created and skipped.
 */
export const createDoitWithdrawalsStep = createStep(
  "create-doit-withdrawals",
  async (input: WithdrawalInput[], { container }) => {
    input.forEach((w, i) => validate(w, input.length > 1 ? `Baris ${i + 1}: ` : ""))
    const service = ledger(container)
    const refs = input.map((w) => w.external_ref).filter((r): r is string => !!r)
    const existing = refs.length ? await service.listDoitWithdrawals({ external_ref: refs }) : []
    const known = new Set(existing.map((w) => w.external_ref))
    const fresh = input.filter((w) => !w.external_ref || !known.has(w.external_ref))
    const created = fresh.length
      ? await service.createDoitWithdrawals(
          fresh.map((w) => ({ ...w, fee_amount: w.fee_amount ?? 0, raw: (w.raw ?? null) as never }))
        )
      : []
    return new StepResponse(
      { created: created.map((w) => w.id), skipped: input.length - fresh.length },
      created.map((w) => w.id)
    )
  },
  async (ids, { container }) => {
    if (ids?.length) await ledger(container).deleteDoitWithdrawals(ids)
  }
)

export const deleteDoitWithdrawalStep = createStep(
  "delete-doit-withdrawal",
  async (id: string, { container }) => {
    const service = ledger(container)
    const [current] = await service.listDoitWithdrawals({ id }, { take: 1 })
    if (!current) {
      throw new MedusaError(MedusaError.Types.NOT_FOUND, `Withdraw ${id} tidak ditemukan.`)
    }
    await service.deleteDoitWithdrawals(id)
    return new StepResponse({ id }, restorable(current as Row))
  },
  async (previous, { container }) => {
    if (previous) await ledger(container).createDoitWithdrawals(previous as never)
  }
)

export type ResolveAttentionInput = {
  id: string
  status: "resolved" | "dismissed"
  note?: string | null
  actor_id?: string | null
}

export const resolveDoitAttentionStep = createStep(
  "resolve-doit-attention",
  async (input: ResolveAttentionInput, { container }) => {
    const service = ledger(container)
    const [current] = await service.listDoitAttentions({ id: input.id }, { take: 1 })
    if (!current) {
      throw new MedusaError(MedusaError.Types.NOT_FOUND, `Item ${input.id} tidak ditemukan.`)
    }
    if (current.status !== "open") {
      throw new MedusaError(MedusaError.Types.NOT_ALLOWED, `Item ${input.id} sudah ditandai ${current.status}.`)
    }
    const updated = await service.updateDoitAttentions({
      id: input.id,
      status: input.status,
      resolution_note: input.note?.trim() || null,
      resolved_by: input.actor_id ?? null,
      resolved_at: new Date(),
    })
    return new StepResponse(updated, restorable(current as Row))
  },
  async (previous, { container }) => {
    if (previous) await ledger(container).updateDoitAttentions(previous as never)
  }
)
