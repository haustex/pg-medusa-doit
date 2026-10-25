import { Badge, Container, Text, Tooltip } from "@medusajs/ui"
import type { ReactNode } from "react"

type Props = {
  label: string
  value: string
  sub?: string
  badge?: string
  hint?: string
  accent?: { color: string; soft: string }
  children?: ReactNode
}

export const StatCard = ({ label, value, sub, badge, hint, accent, children }: Props) => {
  const body = (
    <Container
      className="flex flex-col gap-y-1 px-4 py-3"
      style={accent ? { boxShadow: `inset 3px 0 0 ${accent.color}`, background: accent.soft } : undefined}
    >
      <div className="flex items-center justify-between gap-2">
        <Text size="small" leading="compact" className="text-ui-fg-subtle">
          {label}
        </Text>
        {badge && (
          <Badge size="2xsmall" color="orange">
            {badge}
          </Badge>
        )}
      </div>
      <Text size="xlarge" weight="plus" className="tabular-nums">
        {value}
      </Text>
      {sub && (
        <Text size="xsmall" leading="compact" className="text-ui-fg-muted tabular-nums">
          {sub}
        </Text>
      )}
      {children}
    </Container>
  )
  return hint ? <Tooltip content={hint} maxWidth={320}>{body}</Tooltip> : body
}
