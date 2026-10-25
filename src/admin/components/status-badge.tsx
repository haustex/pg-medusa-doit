import { Badge, StatusBadge } from "@medusajs/ui"
import { useTranslation } from "react-i18next"

const COLORS: Record<string, "green" | "orange" | "grey" | "red" | "purple"> = {
  paid: "green",
  pending: "orange",
  expired: "grey",
  failed: "red",
  refunded: "purple",
}

export const PaymentStatus = ({ status }: { status: string }) => {
  const { t } = useTranslation()
  return <StatusBadge color={COLORS[status] ?? "grey"}>{t(`doit.status.${status}`, { defaultValue: status })}</StatusBadge>
}

export const Flags = ({ flags }: { flags: string[] | null }) => {
  const { t } = useTranslation()
  if (!flags?.length) return null
  return (
    <div className="flex flex-wrap gap-1">
      {flags.map((f) => (
        <Badge key={f} size="2xsmall" color={f === "lunas_manual" ? "grey" : "orange"}>
          {t(`doit.flags.${f}`, { defaultValue: f })}
        </Badge>
      ))}
    </div>
  )
}
