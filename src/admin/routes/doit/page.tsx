import { defineRouteConfig } from "@medusajs/admin-sdk"
import { CogSixTooth, CreditCard } from "@medusajs/icons"
import { Badge, Button, Container, Heading, Tabs, Text } from "@medusajs/ui"
import { useQuery } from "@tanstack/react-query"
import { useState } from "react"
import { useTranslation } from "react-i18next"
import { Link } from "react-router-dom"
import { AttentionTab } from "../../components/attention-tab"
import { CreditFooter } from "../../components/credit-footer"
import { OverviewTab } from "../../components/overview-tab"
import { RangeFilter } from "../../components/range-filter"
import { Loading } from "../../components/states"
import { TransactionsTab } from "../../components/transactions-tab"
import { WithdrawalsTab } from "../../components/withdrawals-tab"
import { doitKeys, qs, useDoitSettings } from "../../lib/api"
import { sdk } from "../../lib/client"
import type { RangeParams } from "../../lib/types"

const TABS = ["overview", "transactions", "withdrawals", "attention"] as const

const DoitDashboardPage = () => {
  const { t } = useTranslation()
  const { data: settingsData, isLoading } = useDoitSettings()
  const [range, setRange] = useState<RangeParams>({ preset: "7d" })
  const [tab, setTab] = useState<(typeof TABS)[number]>("overview")
  const openParams = { status: "open", limit: 1, offset: 0 }
  const { data: open } = useQuery({
    queryKey: doitKeys.attention(openParams),
    queryFn: () => sdk.client.fetch<{ count: number }>(`/admin/doit/attention${qs(openParams)}`),
  })

  if (isLoading || !settingsData) return <Loading />
  const settings = settingsData.settings
  const mode = !settings.configured ? "unknown" : settings.environment === "production" ? "live" : "test"

  return (
    <div className="flex flex-col gap-y-3">
      <Container className="flex flex-wrap items-center justify-between gap-3 px-6 py-4">
        <div className="flex flex-col gap-y-1">
          <div className="flex items-center gap-x-2">
            <Heading>{t("doit.title")}</Heading>
            <Badge size="2xsmall" color={mode === "live" ? "green" : mode === "test" ? "orange" : "grey"}>
              {t(`doit.mode.${mode}`)}
            </Badge>
          </div>
          <Text size="small" className="text-ui-fg-subtle">{t("doit.subtitle")}</Text>
        </div>
        <Button size="small" variant="secondary" asChild>
          <Link to="/settings/doit">
            <CogSixTooth />
            {t("doit.settings.title")}
          </Link>
        </Button>
      </Container>

      <Tabs value={tab} onValueChange={(v) => setTab(v as typeof tab)}>
        <div className="flex flex-wrap items-end justify-between gap-3">
          <Tabs.List>
            {TABS.map((key) => (
              <Tabs.Trigger key={key} value={key}>
                {t(`doit.tabs.${key}`)}
                {key === "attention" && !!open?.count && (
                  <Badge size="2xsmall" color="orange" className="ml-1">
                    {open.count}
                  </Badge>
                )}
              </Tabs.Trigger>
            ))}
          </Tabs.List>
          {(tab === "overview" || tab === "transactions") && (
            <RangeFilter value={range} onChange={setRange} timezone={settings.timezone} />
          )}
        </div>
        <div className="mt-3">
          <Tabs.Content value="overview">
            <OverviewTab range={range} />
          </Tabs.Content>
          <Tabs.Content value="transactions">
            <TransactionsTab range={range} timezone={settings.timezone} />
          </Tabs.Content>
          <Tabs.Content value="withdrawals">
            <WithdrawalsTab timezone={settings.timezone} />
          </Tabs.Content>
          <Tabs.Content value="attention">
            <AttentionTab timezone={settings.timezone} />
          </Tabs.Content>
        </div>
      </Tabs>

      <CreditFooter showCredit={settings.show_credit} />
    </div>
  )
}

export const config = defineRouteConfig({
  label: "doit.id",
  icon: CreditCard,
})

export default DoitDashboardPage
