import { ArrowDownTray } from "@medusajs/icons"
import {
  Badge,
  Button,
  Checkbox,
  Container,
  createDataTableColumnHelper,
  DataTable,
  type DataTablePaginationState,
  Input,
  Label,
  Select,
  Text,
  toast,
  Tooltip,
  useDataTable,
} from "@medusajs/ui"
import { keepPreviousData, useQuery } from "@tanstack/react-query"
import { useEffect, useMemo, useState } from "react"
import { useTranslation } from "react-i18next"
import { Link } from "react-router-dom"
import { doitKeys, qs, usePaginationTranslations } from "../lib/api"
import { sdk } from "../lib/client"
import { formatDateTime, formatRupiah, localeOf } from "../lib/format"
import type { LedgerPayment, RangeParams } from "../lib/types"
import { Flags, PaymentStatus } from "./status-badge"

const PAGE_SIZE = 20
const STATUSES = ["paid", "pending", "failed", "refunded"] as const
const RAILS = ["qris", "va", "transfer"] as const
const ALL = "all"

const columnHelper = createDataTableColumnHelper<LedgerPayment>()

function useDebounced<T>(value: T, ms = 300): T {
  const [v, setV] = useState(value)
  useEffect(() => {
    const id = setTimeout(() => setV(value), ms)
    return () => clearTimeout(id)
  }, [value, ms])
  return v
}

export const TransactionsTab = ({ range, timezone }: { range: RangeParams; timezone: string }) => {
  const { t, i18n } = useTranslation()
  const locale = localeOf(i18n.language)
  const [status, setStatus] = useState<string>(ALL)
  const [rail, setRail] = useState<string>(ALL)
  const [search, setSearch] = useState("")
  // rows that are not this store's payments (other app/store on the key, other mode)
  const [showExcluded, setShowExcluded] = useState(false)
  const q = useDebounced(search.trim())
  const [pagination, setPagination] = useState<DataTablePaginationState>({ pageIndex: 0, pageSize: PAGE_SIZE })
  const [exporting, setExporting] = useState(false)
  const paginationTranslations = usePaginationTranslations()

  // back to the first page whenever a filter changes
  useEffect(() => setPagination((p) => ({ ...p, pageIndex: 0 })), [status, rail, q, range, showExcluded])

  const filters = {
    ...range,
    status: status === ALL ? undefined : status,
    rail: rail === ALL ? undefined : rail,
    q: q || undefined,
    excluded: showExcluded ? "include" : undefined,
  }
  const params = { ...filters, limit: pagination.pageSize, offset: pagination.pageIndex * pagination.pageSize }
  const { data, isLoading } = useQuery({
    queryKey: doitKeys.payments(params),
    queryFn: () => sdk.client.fetch<{ payments: LedgerPayment[]; count: number }>(`/admin/doit/payments${qs(params)}`),
    placeholderData: keepPreviousData,
  })

  const columns = useMemo(
    () => [
      columnHelper.accessor("doit_created_at", {
        header: t("doit.table.created"),
        cell: ({ getValue }) => (
          <Text size="small" className="whitespace-nowrap tabular-nums">{formatDateTime(getValue(), timezone, locale)}</Text>
        ),
      }),
      columnHelper.accessor("reference", {
        header: t("doit.table.reference"),
        cell: ({ row }) => (
          <div className="flex flex-col">
            {row.original.order_id ? (
              <Link to={`/orders/${row.original.order_id}`} className="text-ui-fg-interactive txt-compact-small hover:underline">
                {row.original.order_id}
              </Link>
            ) : (
              <Text size="small" className="truncate">{row.original.reference}</Text>
            )}
            <Text size="xsmall" className="text-ui-fg-muted font-mono">{row.original.doit_id}</Text>
          </div>
        ),
      }),
      columnHelper.accessor("status", {
        header: t("doit.table.status"),
        cell: ({ row }) => (
          <div className="flex flex-col gap-1">
            <PaymentStatus status={row.original.status} />
            <Flags flags={row.original.flags} />
            {row.original.excluded_at && (
              <Tooltip content={t(`doit.table.excluded_reasons.${row.original.excluded_reason}`, { defaultValue: row.original.excluded_reason ?? "" })}>
                <Badge size="2xsmall" color="grey">{t("doit.table.excluded")}</Badge>
              </Tooltip>
            )}
          </div>
        ),
      }),
      columnHelper.accessor("rail", {
        header: t("doit.table.rail"),
        cell: ({ row }) => (
          <Text size="small" className="uppercase">
            {[row.original.rail, row.original.va_bank].filter(Boolean).join(" · ") || "–"}
          </Text>
        ),
      }),
      columnHelper.accessor("amount", {
        header: t("doit.table.amount"),
        cell: ({ getValue }) => <Text size="small" className="tabular-nums">{formatRupiah(getValue())}</Text>,
      }),
      columnHelper.accessor("fee_amount", {
        header: t("doit.table.fee"),
        cell: ({ getValue }) => <Text size="small" className="tabular-nums text-ui-fg-subtle">{formatRupiah(getValue())}</Text>,
      }),
      columnHelper.accessor("net_amount", {
        header: t("doit.table.net"),
        cell: ({ getValue }) => <Text size="small" className="tabular-nums">{formatRupiah(getValue())}</Text>,
      }),
      columnHelper.accessor("refunded_amount", {
        header: t("doit.table.refunded"),
        cell: ({ getValue }) => (
          <Text size="small" className="tabular-nums text-ui-fg-subtle">{getValue() ? formatRupiah(getValue()) : "–"}</Text>
        ),
      }),
    ],
    [t, timezone, locale]
  )

  const table = useDataTable({
    data: data?.payments ?? [],
    columns,
    getRowId: (p) => p.id,
    rowCount: data?.count ?? 0,
    isLoading,
    pagination: { state: pagination, onPaginationChange: setPagination },
  })

  const exportCsv = async () => {
    setExporting(true)
    try {
      // the SDK keeps the session auth; accept text/csv returns the raw response
      const res = (await sdk.client.fetch(`/admin/doit/payments/export${qs(filters)}`, {
        headers: { accept: "text/csv" },
      })) as unknown as Response
      const blob = await res.blob()
      const name = /filename="([^"]+)"/.exec(res.headers.get("content-disposition") ?? "")?.[1] ?? "doit-transaksi.csv"
      const url = URL.createObjectURL(blob)
      const a = Object.assign(document.createElement("a"), { href: url, download: name })
      a.click()
      URL.revokeObjectURL(url)
    } catch (e) {
      toast.error((e as Error).message)
    } finally {
      setExporting(false)
    }
  }

  return (
    <Container className="divide-y p-0">
      <DataTable instance={table}>
        <DataTable.Toolbar className="flex flex-wrap items-center justify-between gap-2 px-6 py-4">
          <div className="flex flex-wrap items-center gap-2">
            <Input
              size="small"
              type="search"
              placeholder={t("doit.table.search")}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-72"
            />
            <div className="w-40">
              <Select size="small" value={status} onValueChange={setStatus}>
                <Select.Trigger aria-label={t("doit.table.status")}>
                  <Select.Value />
                </Select.Trigger>
                <Select.Content>
                  <Select.Item value={ALL}>{`${t("doit.table.status")}: ${t("doit.table.all")}`}</Select.Item>
                  {STATUSES.map((s) => (
                    <Select.Item key={s} value={s}>
                      {s === "failed" ? `${t("doit.status.failed")} / ${t("doit.status.expired")}` : t(`doit.status.${s}`)}
                    </Select.Item>
                  ))}
                </Select.Content>
              </Select>
            </div>
            <div className="w-36">
              <Select size="small" value={rail} onValueChange={setRail}>
                <Select.Trigger aria-label={t("doit.table.rail")}>
                  <Select.Value />
                </Select.Trigger>
                <Select.Content>
                  <Select.Item value={ALL}>{`${t("doit.table.rail")}: ${t("doit.table.all")}`}</Select.Item>
                  {RAILS.map((r) => (
                    <Select.Item key={r} value={r}>
                      {r.toUpperCase()}
                    </Select.Item>
                  ))}
                </Select.Content>
              </Select>
            </div>
            <div className="flex items-center gap-x-2">
              <Checkbox id="doit-show-excluded" checked={showExcluded} onCheckedChange={(v) => setShowExcluded(v === true)} />
              <Label htmlFor="doit-show-excluded" size="small">{t("doit.table.show_excluded")}</Label>
            </div>
          </div>
          <Button size="small" variant="secondary" onClick={exportCsv} isLoading={exporting} disabled={exporting}>
            <ArrowDownTray />
            {exporting ? t("doit.table.exporting") : t("doit.table.export")}
          </Button>
        </DataTable.Toolbar>
        <DataTable.Table emptyState={{ empty: { heading: t("doit.table.empty") }, filtered: { heading: t("doit.table.empty") } }} />
        <DataTable.Pagination translations={paginationTranslations} />
      </DataTable>
    </Container>
  )
}
