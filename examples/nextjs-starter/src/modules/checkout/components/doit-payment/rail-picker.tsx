"use client"

import { DoitChoice, DoitMethod, listDoitMethods } from "@lib/data/doit"
import { Text, clx } from "@medusajs/ui"
import { useEffect, useState } from "react"
import { rupiah } from "./format"
import { bankNames, doitLabels as t } from "./labels"

type Props = {
  cartId: string
  value: DoitChoice | null
  onChange: (choice: DoitChoice) => void
}

const keyOf = (c: { rail: string; va_bank?: string | null; bank?: string | null }) =>
  `${c.rail}:${c.va_bank ?? c.bank ?? ""}`

/**
 * Lists the methods doit.id has active for this store (QRIS, VA banks,
 * transfer banks) with the fee for this cart, and reports the choice.
 */
export default function DoitRailPicker({ cartId, value, onChange }: Props) {
  const [methods, setMethods] = useState<DoitMethod[] | null>(null)
  const [unavailable, setUnavailable] = useState(false)

  useEffect(() => {
    let active = true
    listDoitMethods(cartId).then((res) => {
      if (!active) return
      if (!res.ok || res.data.source !== "doit" || !res.data.methods.length) {
        setUnavailable(true)
        setMethods([])
        if (res.ok && !value) {
          onChange({ rail: res.data.default.rail, va_bank: res.data.default.va_bank })
        }
        return
      }
      setMethods(res.data.methods)
      if (!value) {
        const preferred =
          res.data.methods.find((m) => m.within_limits !== false && keyOf(m) === keyOf(res.data.default)) ??
          res.data.methods.find((m) => m.within_limits !== false) ??
          res.data.methods[0]
        onChange({ rail: preferred.rail, va_bank: preferred.bank })
      }
    })
    return () => {
      active = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cartId])

  if (methods === null) {
    return <Text className="txt-small text-ui-fg-subtle">{t.loading}</Text>
  }
  if (unavailable) {
    return <Text className="txt-small text-ui-fg-subtle">{t.methodsUnavailable}</Text>
  }

  const groups: { title: string; items: DoitMethod[] }[] = [
    { title: t.qris, items: methods.filter((m) => m.rail === "qris") },
    { title: t.va, items: methods.filter((m) => m.rail === "va") },
    { title: t.transfer, items: methods.filter((m) => m.rail === "transfer") },
  ].filter((g) => g.items.length)

  return (
    <div className="flex flex-col gap-y-4" data-testid="doit-rail-picker">
      <Text className="txt-medium-plus text-ui-fg-base">{t.chooseMethod}</Text>
      {groups.map((group) => (
        <fieldset key={group.title} className="flex flex-col gap-y-2">
          {/* QRIS is a single option that already says "QRIS" */}
          {group.items[0].rail !== "qris" && (
            <legend className="txt-small text-ui-fg-subtle mb-1">{group.title}</legend>
          )}
          <div className="grid grid-cols-1 small:grid-cols-2 gap-2">
            {group.items.map((m) => {
              const selected = value ? keyOf(value) === keyOf(m) : false
              const disabled = m.within_limits === false
              const customerFee = m.fee_payer === "customer" && m.fee_amount ? m.fee_amount : 0
              const fee = disabled ? t.outsideLimit(m.limit) : customerFee ? t.feeByCustomer(rupiah(customerFee)) : t.noFee
              return (
                <label
                  key={m.code}
                  className={clx(
                    "flex items-center justify-between gap-x-3 rounded-rounded border px-4 py-3",
                    disabled ? "cursor-not-allowed opacity-50" : "cursor-pointer hover:shadow-borders-interactive-with-active",
                    selected ? "border-ui-border-interactive" : "border-ui-border-base"
                  )}
                  data-testid={`doit-method-${m.code}`}
                >
                  <span className="flex items-center gap-x-3">
                    <input
                      type="radio"
                      name="doit-method"
                      className="accent-ui-fg-interactive"
                      checked={selected}
                      disabled={disabled}
                      onChange={() => onChange({ rail: m.rail, va_bank: m.bank })}
                    />
                    <span className="flex flex-col">
                      <span className="txt-compact-medium text-ui-fg-base">
                        {m.rail === "qris" ? t.qris : bankNames[m.bank ?? ""] ?? m.label}
                      </span>
                      {m.rail === "qris" && <span className="txt-small text-ui-fg-subtle">{t.qrisHint}</span>}
                    </span>
                  </span>
                  <span className="flex flex-col items-end txt-small text-ui-fg-subtle whitespace-nowrap">
                    <span>{fee}</span>
                    {!disabled && customerFee > 0 && m.total_amount !== null && (
                      <span className="text-ui-fg-base">{t.totalWithFee(rupiah(m.total_amount))}</span>
                    )}
                  </span>
                </label>
              )
            })}
          </div>
        </fieldset>
      ))}
      <Text className="txt-small text-ui-fg-muted">{t.feeNote}</Text>
    </div>
  )
}
