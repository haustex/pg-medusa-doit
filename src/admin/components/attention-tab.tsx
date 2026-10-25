import { Badge, Button, Container, Drawer, Heading, Label, Select, Text, Textarea, toast } from "@medusajs/ui"
import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { useState } from "react"
import { useTranslation } from "react-i18next"
import { Link } from "react-router-dom"
import { doitKeys, qs } from "../lib/api"
import { sdk } from "../lib/client"
import { formatDateTime, formatRupiah, localeOf } from "../lib/format"
import type { Attention } from "../lib/types"
import { Empty, Loading } from "./states"

const FILTERS = ["open", "resolved", "dismissed", "all"] as const

export const AttentionTab = ({ timezone }: { timezone: string }) => {
  const { t, i18n } = useTranslation()
  const locale = localeOf(i18n.language)
  const [status, setStatus] = useState<(typeof FILTERS)[number]>("open")
  const [selected, setSelected] = useState<Attention | null>(null)
  const params = { status, limit: 50, offset: 0 }
  const { data, isLoading } = useQuery({
    queryKey: doitKeys.attention(params),
    queryFn: () => sdk.client.fetch<{ items: Attention[]; count: number }>(`/admin/doit/attention${qs(params)}`),
    placeholderData: keepPreviousData,
  })

  return (
    <Container className="divide-y p-0">
      <div className="flex flex-wrap items-start justify-between gap-3 px-6 py-4">
        <div className="flex flex-col gap-y-1">
          <Heading level="h2">{t("doit.attention.title")}</Heading>
          <Text size="small" className="text-ui-fg-subtle">{t("doit.attention.description")}</Text>
        </div>
        <div className="w-40">
          <Select size="small" value={status} onValueChange={(v) => setStatus(v as typeof status)}>
            <Select.Trigger>
              <Select.Value />
            </Select.Trigger>
            <Select.Content>
              {FILTERS.map((f) => (
                <Select.Item key={f} value={f}>{t(`doit.attention.${f}`)}</Select.Item>
              ))}
            </Select.Content>
          </Select>
        </div>
      </div>
      {isLoading ? (
        <Loading />
      ) : !data?.items.length ? (
        <Empty>{t("doit.attention.empty")}</Empty>
      ) : (
        data.items.map((item) => (
          <div key={item.id} className="flex flex-wrap items-start justify-between gap-3 px-6 py-4">
            <div className="flex min-w-0 max-w-3xl flex-col gap-y-1">
              <div className="flex flex-wrap items-center gap-2">
                <Badge size="2xsmall" color={item.status === "open" ? "orange" : "grey"}>
                  {t(`doit.attention.codes.${item.code}`, { defaultValue: item.code })}
                </Badge>
                {item.amount !== null && <Text size="xsmall" className="tabular-nums text-ui-fg-subtle">{formatRupiah(item.amount)}</Text>}
                <Text size="xsmall" className="text-ui-fg-muted">{formatDateTime(item.created_at, timezone, locale)}</Text>
              </div>
              <Text size="small">{item.message}</Text>
              <div className="flex flex-wrap gap-x-3">
                {item.order_id && (
                  <Link to={`/orders/${item.order_id}`} className="txt-compact-xsmall text-ui-fg-interactive hover:underline">
                    {item.order_id}
                  </Link>
                )}
                {item.doit_payment_id && <Text size="xsmall" className="font-mono text-ui-fg-muted">{item.doit_payment_id}</Text>}
              </div>
              {item.status !== "open" && (
                <Text size="xsmall" className="text-ui-fg-muted">
                  {t("doit.attention.resolved_by", {
                    status: t(`doit.attention.${item.status}`),
                    date: formatDateTime(item.resolved_at, timezone, locale),
                  })}
                  {item.resolution_note ? ` — ${item.resolution_note}` : ""}
                </Text>
              )}
            </div>
            {item.status === "open" && (
              <Button size="small" variant="secondary" onClick={() => setSelected(item)}>
                {t("doit.attention.resolve")}
              </Button>
            )}
          </div>
        ))
      )}
      <ResolveDrawer item={selected} onClose={() => setSelected(null)} />
    </Container>
  )
}

const ResolveDrawer = ({ item, onClose }: { item: Attention | null; onClose: () => void }) => {
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  const [note, setNote] = useState("")
  const resolve = useMutation({
    mutationFn: (status: "resolved" | "dismissed") =>
      sdk.client.fetch(`/admin/doit/attention/${item!.id}/resolve`, { method: "POST", body: { status, note: note.trim() || null } }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["doit", "attention"] })
      queryClient.invalidateQueries({ queryKey: ["doit", "stats"] })
      toast.success(t("doit.attention.done"))
      setNote("")
      onClose()
    },
    onError: (e) => toast.error((e as Error).message),
  })

  return (
    <Drawer open={!!item} onOpenChange={(open) => !open && onClose()}>
      <Drawer.Content>
        <Drawer.Header>
          <Drawer.Title>{item ? t(`doit.attention.codes.${item.code}`, { defaultValue: item.code }) : ""}</Drawer.Title>
        </Drawer.Header>
        <Drawer.Body className="flex flex-col gap-y-4 overflow-auto p-4">
          <Text size="small">{item?.message}</Text>
          <div className="flex flex-col gap-y-2">
            <Label htmlFor="att-note">{t("doit.attention.note")}</Label>
            <Textarea id="att-note" rows={5} maxLength={1000} value={note} onChange={(e) => setNote(e.target.value)} />
          </div>
        </Drawer.Body>
        <Drawer.Footer>
          <div className="flex items-center justify-end gap-x-2">
            <Button size="small" variant="secondary" disabled={resolve.isPending} onClick={() => resolve.mutate("dismissed")}>
              {t("doit.attention.dismiss")}
            </Button>
            <Button size="small" disabled={resolve.isPending} isLoading={resolve.isPending} onClick={() => resolve.mutate("resolved")}>
              {t("doit.attention.resolve")}
            </Button>
          </div>
        </Drawer.Footer>
      </Drawer.Content>
    </Drawer>
  )
}
