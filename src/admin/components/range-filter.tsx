import { Button, Input, Select, Text } from "@medusajs/ui"
import { useState } from "react"
import { useTranslation } from "react-i18next"
import type { RangeParams } from "../lib/types"

type Props = {
  value: RangeParams
  onChange: (value: RangeParams) => void
  timezone: string
}

const PRESETS = ["today", "7d", "month", "custom"] as const

/** Today / 7 days / this month / custom; day boundaries are applied by the server in `timezone`. */
export const RangeFilter = ({ value, onChange, timezone }: Props) => {
  const { t } = useTranslation()
  const [from, setFrom] = useState(value.from ?? "")
  const [to, setTo] = useState(value.to ?? "")

  return (
    <div className="flex flex-col gap-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <div className="w-44">
          <Select
            size="small"
            value={value.preset}
            onValueChange={(preset) =>
              onChange(preset === "custom" ? { preset, from: from || undefined, to: to || undefined } : { preset: preset as RangeParams["preset"] })
            }
          >
            <Select.Trigger>
              <Select.Value />
            </Select.Trigger>
            <Select.Content>
              {PRESETS.map((p) => (
                <Select.Item key={p} value={p}>
                  {t(`doit.range.${p}`)}
                </Select.Item>
              ))}
            </Select.Content>
          </Select>
        </div>
        {value.preset === "custom" && (
          <>
            <Input size="small" type="date" aria-label={t("doit.range.from")} value={from} onChange={(e) => setFrom(e.target.value)} className="w-40" />
            <Input size="small" type="date" aria-label={t("doit.range.to")} value={to} onChange={(e) => setTo(e.target.value)} className="w-40" />
            <Button size="small" variant="secondary" disabled={!from || !to || from > to} onClick={() => onChange({ preset: "custom", from, to })}>
              {t("doit.range.apply")}
            </Button>
          </>
        )}
      </div>
      <Text size="xsmall" leading="compact" className="text-ui-fg-muted">
        {t("doit.range.timezone", { tz: timezone })}
      </Text>
    </div>
  )
}
