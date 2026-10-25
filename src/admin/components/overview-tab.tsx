import { Container, Heading, Text } from "@medusajs/ui"
import { useQuery } from "@tanstack/react-query"
import { useTranslation } from "react-i18next"
import { useAccent } from "../lib/accent"
import { doitKeys, qs } from "../lib/api"
import { sdk } from "../lib/client"
import { formatNumber, formatRupiah } from "../lib/format"
import type { RangeParams, StatsResponse } from "../lib/types"
import { DailyChart } from "./daily-chart"
import { Loading, LoadError } from "./states"
import { StatCard } from "./stat-card"

export const OverviewTab = ({ range }: { range: RangeParams }) => {
  const { t } = useTranslation()
  const accent = useAccent()
  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: doitKeys.stats(range),
    queryFn: () => sdk.client.fetch<StatsResponse>(`/admin/doit/stats${qs(range)}`),
  })

  if (isLoading) return <Loading />
  if (isError || !data) return <LoadError onRetry={() => refetch()} />

  const s = data.stats
  const ca = (c: { count: number; amount: number }) =>
    t("doit.cards.count_amount", { n: formatNumber(c.count), amount: formatRupiah(c.amount) })

  return (
    <div className="flex flex-col gap-y-3">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label={t("doit.cards.success")} value={formatNumber(s.success.count)} sub={formatRupiah(s.success.amount)} />
        <StatCard label={t("doit.cards.pending")} value={formatNumber(s.pending.count)} sub={formatRupiah(s.pending.amount)} />
        <StatCard label={t("doit.cards.failed")} value={formatNumber(s.failed.count)} sub={formatRupiah(s.failed.amount)} />
        <StatCard label={t("doit.cards.refunds")} value={formatNumber(s.refunds.count)} sub={formatRupiah(s.refunds.amount)} />
      </div>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-5">
        <StatCard label={t("doit.cards.gross")} value={formatRupiah(s.gross)} sub={t("doit.cards.in_range")} />
        <StatCard label={t("doit.cards.fee")} value={formatRupiah(s.fee)} sub={t("doit.cards.in_range")} />
        <StatCard label={t("doit.cards.net")} value={formatRupiah(s.net)} sub={t("doit.cards.in_range")} />
        <StatCard label={t("doit.cards.withdrawals")} value={formatRupiah(s.withdrawals.amount)} sub={ca(s.withdrawals)} />
        <StatCard
          label={t("doit.cards.balance")}
          badge={t("doit.cards.balance_estimate")}
          value={formatRupiah(s.balance.estimate)}
          sub={`${formatRupiah(s.balance.net_paid)} − ${formatRupiah(s.balance.refunded)} − ${formatRupiah(s.balance.withdrawn)}`}
          hint={t("doit.cards.balance_hint")}
          accent={accent}
        />
      </div>
      <Container className="flex flex-col gap-y-3 px-6 py-4">
        <Heading level="h2">{t("doit.chart.title")}</Heading>
        <DailyChart series={data.series} />
      </Container>
      <Text size="xsmall" className="text-ui-fg-muted">
        {t("doit.cards.balance_hint")}
      </Text>
    </div>
  )
}
