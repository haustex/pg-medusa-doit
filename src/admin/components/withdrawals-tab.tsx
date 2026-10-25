import { ArrowUpTray, Plus, Trash } from "@medusajs/icons"
import {
  Badge,
  Button,
  Container,
  FocusModal,
  Heading,
  IconButton,
  Input,
  Label,
  Table,
  Text,
  Textarea,
  toast,
  usePrompt,
} from "@medusajs/ui"
import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { useState } from "react"
import { useTranslation } from "react-i18next"
import { doitKeys, qs, usePaginationTranslations } from "../lib/api"
import { sdk } from "../lib/client"
import { formatRupiah } from "../lib/format"
import type { ImportSummary, Withdrawal } from "../lib/types"
import { Empty, Loading } from "./states"

const PAGE_SIZE = 20

function todayIn(tz: string) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: tz }).format(new Date())
}

export const WithdrawalsTab = ({ timezone }: { timezone: string }) => {
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  const prompt = usePrompt()
  const paginationTranslations = usePaginationTranslations()
  const [page, setPage] = useState(0)
  const params = { limit: PAGE_SIZE, offset: page * PAGE_SIZE }
  const { data, isLoading } = useQuery({
    queryKey: doitKeys.withdrawals(params),
    queryFn: () => sdk.client.fetch<{ withdrawals: Withdrawal[]; count: number }>(`/admin/doit/withdrawals${qs(params)}`),
    placeholderData: keepPreviousData,
  })
  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ["doit", "withdrawals"] })
    queryClient.invalidateQueries({ queryKey: ["doit", "stats"] })
  }

  const remove = useMutation({
    mutationFn: (id: string) => sdk.client.fetch(`/admin/doit/withdrawals/${id}`, { method: "DELETE" }),
    onSuccess: () => {
      invalidate()
      toast.success(t("doit.withdrawals.deleted"))
    },
    onError: (e) => toast.error((e as Error).message),
  })

  const pages = Math.max(1, Math.ceil((data?.count ?? 0) / PAGE_SIZE))

  return (
    <Container className="divide-y p-0">
      <div className="flex flex-wrap items-start justify-between gap-3 px-6 py-4">
        <div className="flex max-w-xl flex-col gap-y-1">
          <Heading level="h2">{t("doit.withdrawals.title")}</Heading>
          <Text size="small" className="text-ui-fg-subtle">{t("doit.withdrawals.description")}</Text>
        </div>
        <div className="flex gap-2">
          <ImportSettlement onDone={invalidate} />
          <AddWithdrawal timezone={timezone} onDone={invalidate} />
        </div>
      </div>
      {isLoading ? (
        <Loading />
      ) : !data?.withdrawals.length ? (
        <Empty>{t("doit.withdrawals.empty")}</Empty>
      ) : (
        <>
          <Table>
            <Table.Header>
              <Table.Row>
                <Table.HeaderCell>{t("doit.withdrawals.date")}</Table.HeaderCell>
                <Table.HeaderCell className="text-right">{t("doit.withdrawals.amount")}</Table.HeaderCell>
                <Table.HeaderCell className="text-right">{t("doit.withdrawals.fee")}</Table.HeaderCell>
                <Table.HeaderCell>{t("doit.withdrawals.note")}</Table.HeaderCell>
                <Table.HeaderCell>{t("doit.withdrawals.source")}</Table.HeaderCell>
                <Table.HeaderCell />
              </Table.Row>
            </Table.Header>
            <Table.Body>
              {data.withdrawals.map((w) => (
                <Table.Row key={w.id}>
                  <Table.Cell className="tabular-nums">{w.date}</Table.Cell>
                  <Table.Cell className="text-right tabular-nums">{formatRupiah(w.amount)}</Table.Cell>
                  <Table.Cell className="text-right tabular-nums text-ui-fg-subtle">{formatRupiah(w.fee_amount)}</Table.Cell>
                  <Table.Cell className="max-w-xs truncate">{w.note ?? "–"}</Table.Cell>
                  <Table.Cell>
                    <Badge size="2xsmall" color={w.source === "csv" ? "blue" : "grey"}>{t(`doit.withdrawals.${w.source}`)}</Badge>
                  </Table.Cell>
                  <Table.Cell className="text-right">
                    <IconButton
                      size="small"
                      variant="transparent"
                      aria-label={t("doit.withdrawals.delete")}
                      disabled={remove.isPending}
                      onClick={async () => {
                        const ok = await prompt({
                          title: t("doit.withdrawals.delete"),
                          description: t("doit.withdrawals.delete_confirm", { amount: formatRupiah(w.amount + w.fee_amount) }),
                          confirmText: t("doit.withdrawals.delete"),
                          cancelText: t("doit.withdrawals.cancel"),
                        })
                        if (ok) remove.mutate(w.id)
                      }}
                    >
                      <Trash />
                    </IconButton>
                  </Table.Cell>
                </Table.Row>
              ))}
            </Table.Body>
          </Table>
          <Table.Pagination
            count={data.count}
            pageSize={PAGE_SIZE}
            pageIndex={page}
            pageCount={pages}
            canPreviousPage={page > 0}
            canNextPage={page + 1 < pages}
            previousPage={() => setPage((p) => p - 1)}
            nextPage={() => setPage((p) => p + 1)}
            translations={paginationTranslations}
          />
        </>
      )}
    </Container>
  )
}

const AddWithdrawal = ({ timezone, onDone }: { timezone: string; onDone: () => void }) => {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  const empty = { date: todayIn(timezone), amount: "", fee_amount: "0", note: "" }
  const [form, setForm] = useState(empty)
  const amount = Number(form.amount)
  const fee = Number(form.fee_amount || 0)
  const valid = /^\d{4}-\d{2}-\d{2}$/.test(form.date) && Number.isInteger(amount) && amount > 0 && Number.isInteger(fee) && fee >= 0

  const create = useMutation({
    mutationFn: () =>
      sdk.client.fetch("/admin/doit/withdrawals", {
        method: "POST",
        body: { date: form.date, amount, fee_amount: fee, note: form.note.trim() || null },
      }),
    onSuccess: () => {
      onDone()
      toast.success(t("doit.withdrawals.saved"))
      setOpen(false)
      setForm(empty)
    },
    onError: (e) => toast.error((e as Error).message),
  })

  return (
    <FocusModal open={open} onOpenChange={setOpen}>
      <FocusModal.Trigger asChild>
        <Button size="small">
          <Plus />
          {t("doit.withdrawals.add")}
        </Button>
      </FocusModal.Trigger>
      <FocusModal.Content>
        <FocusModal.Header>
          <div className="flex items-center justify-end gap-x-2">
            <FocusModal.Close asChild>
              <Button size="small" variant="secondary" disabled={create.isPending}>{t("doit.withdrawals.cancel")}</Button>
            </FocusModal.Close>
            <Button size="small" disabled={!valid || create.isPending} isLoading={create.isPending} onClick={() => create.mutate()}>
              {t("doit.withdrawals.save")}
            </Button>
          </div>
        </FocusModal.Header>
        <FocusModal.Body className="flex flex-col items-center overflow-auto py-16">
          <div className="flex w-full max-w-lg flex-col gap-y-6">
            <Heading>{t("doit.withdrawals.add")}</Heading>
            <div className="flex flex-col gap-y-2">
              <Label htmlFor="wd-date">{t("doit.withdrawals.date")}</Label>
              <Input id="wd-date" type="date" value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} />
            </div>
            <div className="flex flex-col gap-y-2">
              <Label htmlFor="wd-amount">{t("doit.withdrawals.amount")}</Label>
              <Input id="wd-amount" type="number" inputMode="numeric" min={1} step={1} placeholder="1500000" value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} />
              {form.amount !== "" && <Text size="xsmall" className="text-ui-fg-subtle tabular-nums">{formatRupiah(amount || 0)}</Text>}
            </div>
            <div className="flex flex-col gap-y-2">
              <Label htmlFor="wd-fee">{t("doit.withdrawals.fee")}</Label>
              <Input id="wd-fee" type="number" inputMode="numeric" min={0} step={1} value={form.fee_amount} onChange={(e) => setForm({ ...form, fee_amount: e.target.value })} />
              <Text size="xsmall" className="text-ui-fg-subtle">{t("doit.withdrawals.fee_hint")}</Text>
            </div>
            <div className="flex flex-col gap-y-2">
              <Label htmlFor="wd-note">{t("doit.withdrawals.note")}</Label>
              <Textarea id="wd-note" maxLength={500} value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} />
            </div>
          </div>
        </FocusModal.Body>
      </FocusModal.Content>
    </FocusModal>
  )
}

const ImportSettlement = ({ onDone }: { onDone: () => void }) => {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  const [csv, setCsv] = useState<string | null>(null)
  const [summary, setSummary] = useState<ImportSummary | null>(null)

  const send = (dryRun: boolean) =>
    sdk.client.fetch<ImportSummary>("/admin/doit/withdrawals/import", { method: "POST", body: { csv, dry_run: dryRun } })

  const preview = useMutation({
    mutationFn: () => send(true),
    onSuccess: setSummary,
    onError: (e) => toast.error((e as Error).message),
  })
  const commit = useMutation({
    mutationFn: () => send(false),
    onSuccess: (res) => {
      onDone()
      toast.success(t("doit.withdrawals.csv_done", { count: res.created ?? 0 }))
      setOpen(false)
      setCsv(null)
      setSummary(null)
    },
    onError: (e) => toast.error((e as Error).message),
  })

  const onFile = async (file: File | undefined) => {
    setSummary(null)
    if (!file) return
    setCsv(await file.text())
  }

  return (
    <FocusModal open={open} onOpenChange={setOpen}>
      <FocusModal.Trigger asChild>
        <Button size="small" variant="secondary">
          <ArrowUpTray />
          {t("doit.withdrawals.import")}
        </Button>
      </FocusModal.Trigger>
      <FocusModal.Content>
        <FocusModal.Header>
          <div className="flex items-center justify-end gap-x-2">
            <FocusModal.Close asChild>
              <Button size="small" variant="secondary">{t("doit.withdrawals.cancel")}</Button>
            </FocusModal.Close>
            <Button
              size="small"
              disabled={!summary?.new_rows || commit.isPending}
              isLoading={commit.isPending}
              onClick={() => commit.mutate()}
            >
              {t("doit.withdrawals.csv_import", { count: summary?.new_rows ?? 0 })}
            </Button>
          </div>
        </FocusModal.Header>
        <FocusModal.Body className="flex flex-col items-center overflow-auto py-16">
          <div className="flex w-full max-w-3xl flex-col gap-y-6">
            <Heading>{t("doit.withdrawals.import")}</Heading>
            <Text size="small" className="text-ui-fg-subtle">{t("doit.withdrawals.csv_help")}</Text>
            <div className="flex items-center gap-2">
              <Input type="file" accept=".csv,text/csv" aria-label={t("doit.withdrawals.csv_pick")} onChange={(e) => onFile(e.target.files?.[0])} />
              <Button size="small" variant="secondary" disabled={!csv || preview.isPending} isLoading={preview.isPending} onClick={() => preview.mutate()}>
                {t("doit.withdrawals.csv_preview")}
              </Button>
            </div>
            {summary && (
              <div className="flex flex-col gap-y-3">
                <Text size="small" weight="plus">
                  {t("doit.withdrawals.csv_summary", {
                    new: summary.new_rows,
                    amount: formatRupiah(summary.new_amount),
                    dup: summary.duplicate_rows,
                    skipped: summary.skipped.length,
                    errors: summary.errors.length,
                  })}
                </Text>
                <Text size="xsmall" className="text-ui-fg-subtle">
                  {t("doit.withdrawals.csv_columns")}:{" "}
                  {Object.entries(summary.columns).map(([k, v]) => `${k} ← "${v}"`).join(", ")}
                </Text>
                {[...summary.errors.map((e) => ({ line: e.line, text: e.message, error: true })), ...summary.skipped.map((s) => ({ line: s.line, text: s.reason, error: false }))]
                  .slice(0, 20)
                  .map((m) => (
                    <Text key={`${m.line}-${m.text}`} size="xsmall" className={m.error ? "text-ui-fg-error" : "text-ui-fg-muted"}>
                      {t("doit.withdrawals.csv_line")} {m.line}: {m.text}
                    </Text>
                  ))}
                <Table>
                  <Table.Header>
                    <Table.Row>
                      <Table.HeaderCell>{t("doit.withdrawals.csv_line")}</Table.HeaderCell>
                      <Table.HeaderCell>{t("doit.withdrawals.date")}</Table.HeaderCell>
                      <Table.HeaderCell className="text-right">{t("doit.withdrawals.amount")}</Table.HeaderCell>
                      <Table.HeaderCell className="text-right">{t("doit.withdrawals.fee")}</Table.HeaderCell>
                      <Table.HeaderCell>{t("doit.withdrawals.note")}</Table.HeaderCell>
                    </Table.Row>
                  </Table.Header>
                  <Table.Body>
                    {summary.preview.map((r) => (
                      <Table.Row key={r.line} className={r.duplicate ? "opacity-50" : undefined}>
                        <Table.Cell>{r.line}</Table.Cell>
                        <Table.Cell className="tabular-nums">{r.date}</Table.Cell>
                        <Table.Cell className="text-right tabular-nums">{formatRupiah(r.amount)}</Table.Cell>
                        <Table.Cell className="text-right tabular-nums">{formatRupiah(r.fee_amount)}</Table.Cell>
                        <Table.Cell>
                          {r.duplicate ? <Badge size="2xsmall">{t("doit.withdrawals.duplicate")}</Badge> : r.note ?? "–"}
                        </Table.Cell>
                      </Table.Row>
                    ))}
                  </Table.Body>
                </Table>
              </div>
            )}
          </div>
        </FocusModal.Body>
      </FocusModal.Content>
    </FocusModal>
  )
}
