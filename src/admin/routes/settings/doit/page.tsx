import { defineRouteConfig } from "@medusajs/admin-sdk"
import { CheckCircle, ExclamationCircle } from "@medusajs/icons"
import {
  Alert,
  Badge,
  Button,
  Container,
  Copy,
  Heading,
  Input,
  Label,
  Select,
  Text,
  toast,
} from "@medusajs/ui"
import { useMutation, useQueryClient } from "@tanstack/react-query"
import { useEffect, useState } from "react"
import { useTranslation } from "react-i18next"
import { CreditFooter } from "../../../components/credit-footer"
import { Loading } from "../../../components/states"
import { doitKeys, useDoitSettings } from "../../../lib/api"
import { sdk } from "../../../lib/client"
import type { PublicSettings, TestConnectionResult } from "../../../lib/types"

const RAILS = ["any", "qris", "va", "transfer"] as const
const VA_BANKS = ["bmri", "bnia", "brin", "cimb", "permata", "maybank", "danamon", "bsyi"]
const TRANSFER_BANKS = ["bca", "mandiri", "bni", "bsi"]
const TIMEZONES = ["Asia/Jakarta", "Asia/Makassar", "Asia/Jayapura", "Asia/Singapore", "UTC"]

const Section = ({ title, children }: { title: string; children: React.ReactNode }) => (
  <Container className="divide-y p-0">
    <div className="px-6 py-4">
      <Heading level="h2">{title}</Heading>
    </div>
    <div className="flex flex-col gap-y-5 px-6 py-4">{children}</div>
  </Container>
)

const Field = ({ id, label, hint, children }: { id: string; label: string; hint?: string; children: React.ReactNode }) => (
  <div className="grid grid-cols-1 gap-2 md:grid-cols-[240px_1fr] md:gap-6">
    <div className="flex flex-col gap-y-1">
      <Label htmlFor={id} size="small" weight="plus">{label}</Label>
      {hint && <Text size="xsmall" className="text-ui-fg-subtle">{hint}</Text>}
    </div>
    <div className="flex min-w-0 flex-col gap-y-1">{children}</div>
  </div>
)

const DoitSettingsPage = () => {
  const { data, isLoading } = useDoitSettings()
  if (isLoading || !data) return <Loading />
  return <SettingsForm settings={data.settings} />
}

const SettingsForm = ({ settings }: { settings: PublicSettings }) => {
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  const [apiKey, setApiKey] = useState("")
  const [secret, setSecret] = useState("")
  const [rail, setRail] = useState(settings.rail)
  const [vaBank, setVaBank] = useState(settings.va_bank ?? "")
  const [minutes, setMinutes] = useState(String(Math.round(settings.expires_in / 60)))
  const [timezone, setTimezone] = useState(settings.timezone)
  const [test, setTest] = useState<TestConnectionResult | null>(null)

  useEffect(() => {
    setRail(settings.rail)
    setVaBank(settings.va_bank ?? "")
    setMinutes(String(Math.round(settings.expires_in / 60)))
    setTimezone(settings.timezone)
  }, [settings])

  const banks = rail === "va" ? VA_BANKS : rail === "transfer" ? TRANSFER_BANKS : []
  const needsBank = banks.length > 0
  const minutesNum = Number(minutes)
  const valid =
    Number.isInteger(minutesNum) && minutesNum >= 1 && (!needsBank || banks.includes(vaBank)) && timezone.trim() !== "" &&
    (!apiKey || /^pb_(test|live)_\S+$/.test(apiKey.trim()))
  const typedMode = apiKey.startsWith("pb_live_") ? "live" : apiKey.startsWith("pb_test_") ? "test" : null
  const currentMode = settings.environment === "production" ? "live" : settings.environment === "sandbox" ? "test" : null
  const mode = typedMode ?? currentMode

  const save = useMutation({
    mutationFn: () =>
      sdk.client.fetch<{ settings: PublicSettings }>("/admin/doit/settings", {
        method: "POST",
        body: {
          ...(apiKey.trim() ? { api_key: apiKey.trim() } : {}),
          ...(secret.trim() ? { webhook_secret: secret.trim() } : {}),
          rail,
          va_bank: needsBank ? vaBank : null,
          expires_in: minutesNum * 60,
          timezone: timezone.trim(),
        },
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: doitKeys.settings })
      queryClient.invalidateQueries({ queryKey: ["doit"] })
      setApiKey("")
      setSecret("")
      toast.success(t("doit.settings.saved"))
    },
    onError: (e) => toast.error((e as Error).message),
  })

  const testConnection = useMutation({
    mutationFn: () =>
      sdk.client.fetch<TestConnectionResult>("/admin/doit/test-connection", {
        method: "POST",
        body: apiKey.trim() ? { api_key: apiKey.trim() } : {},
      }),
    onSuccess: setTest,
    onError: (e) => toast.error((e as Error).message),
  })

  const encryptionOk = settings.encryption.status === "ok" || settings.encryption.status === "unused"
  const webhookUrl = settings.webhook_url ?? `${window.location.origin}${settings.webhook_path}`

  return (
    <div className="flex flex-col gap-y-3">
      <Container className="flex flex-wrap items-center justify-between gap-3 px-6 py-4">
        <div className="flex flex-col gap-y-1">
          <Heading>{t("doit.settings.title")}</Heading>
          <Text size="small" className="text-ui-fg-subtle">{t("doit.settings.description")}</Text>
        </div>
        <div className="flex gap-2">
          <Button size="small" variant="secondary" onClick={() => testConnection.mutate()} isLoading={testConnection.isPending} disabled={testConnection.isPending || (!apiKey && !settings.api_key.is_set)}>
            {testConnection.isPending ? t("doit.settings.testing") : t("doit.settings.test")}
          </Button>
          <Button size="small" onClick={() => save.mutate()} isLoading={save.isPending} disabled={!valid || save.isPending}>
            {t("doit.settings.save")}
          </Button>
        </div>
      </Container>

      {test && (
        <Alert variant={test.ok ? (test.mode_mismatch ? "warning" : "success") : "error"} dismissible>
          {test.ok ? (
            <div className="flex flex-col gap-y-1">
              <Text size="small" weight="plus">
                {t("doit.settings.test_ok", { ms: test.latency_ms, env: test.environment ?? test.key_mode })}
              </Text>
              {test.mode_mismatch && <Text size="small">{t("doit.settings.test_mismatch")}</Text>}
              <Text size="small">
                {t("doit.settings.test_methods")}: {test.methods.map((m) => m.label || m.code).join(", ") || "–"}
              </Text>
            </div>
          ) : (
            <Text size="small">{t("doit.settings.test_failed", { message: `${test.error.message} (${test.error.code})` })}</Text>
          )}
        </Alert>
      )}

      <Section title={t("doit.settings.credentials")}>
        <Field id="doit-api-key" label={t("doit.settings.api_key")} hint={t("doit.settings.api_key_hint")}>
          <Input id="doit-api-key" type="password" autoComplete="off" placeholder={settings.api_key.masked ?? "pb_test_…"} value={apiKey} onChange={(e) => setApiKey(e.target.value)} />
          <Text size="xsmall" className="text-ui-fg-muted">
            {t("doit.settings.current", { value: settings.api_key.masked ?? t("doit.settings.not_set") })} ·{" "}
            {t("doit.settings.source", { source: t(`doit.settings.sources.${settings.credential_source}`) })}
          </Text>
        </Field>
        <Field id="doit-secret" label={t("doit.settings.webhook_secret")} hint={t("doit.settings.webhook_secret_hint")}>
          <Input id="doit-secret" type="password" autoComplete="off" placeholder={settings.webhook_secret.masked ?? "whsec_…"} value={secret} onChange={(e) => setSecret(e.target.value)} />
          <Text size="xsmall" className="text-ui-fg-muted">
            {t("doit.settings.current", { value: settings.webhook_secret.masked ?? t("doit.settings.not_set") })}
          </Text>
        </Field>
        <Field id="doit-mode" label={t("doit.settings.mode")} hint={t("doit.settings.mode_hint")}>
          <div>
            <Badge size="small" color={mode === "live" ? "green" : mode === "test" ? "orange" : "grey"}>
              {t(`doit.mode.${mode ?? "unknown"}`)}
            </Badge>
          </div>
        </Field>
        <Field id="doit-encryption" label={t("doit.settings.encryption")}>
          <div className="flex items-center gap-x-2">
            {encryptionOk ? <CheckCircle className="text-ui-fg-interactive" /> : <ExclamationCircle className="text-ui-fg-error" />}
            <Text size="small" className={encryptionOk ? undefined : "text-ui-fg-error"}>
              {t(`doit.settings.encryption_status.${settings.encryption.status}`)}
            </Text>
          </div>
          {settings.encryption.message && <Text size="xsmall" className="text-ui-fg-error">{settings.encryption.message}</Text>}
        </Field>
      </Section>

      <Section title={t("doit.settings.payment")}>
        <Field id="doit-rail" label={t("doit.settings.rail")}>
          <Select value={rail} onValueChange={(v) => setRail(v as PublicSettings["rail"])}>
            <Select.Trigger id="doit-rail">
              <Select.Value />
            </Select.Trigger>
            <Select.Content>
              {RAILS.map((r) => (
                <Select.Item key={r} value={r}>{t(`doit.settings.rails.${r}`)}</Select.Item>
              ))}
            </Select.Content>
          </Select>
          {rail === "transfer" && <Text size="xsmall" className="text-ui-fg-error">{t("doit.settings.transfer_warning")}</Text>}
        </Field>
        {needsBank && (
          <Field id="doit-bank" label={t("doit.settings.va_bank")} hint={t("doit.settings.va_bank_hint")}>
            <Select value={vaBank} onValueChange={setVaBank}>
              <Select.Trigger id="doit-bank">
                <Select.Value placeholder="–" />
              </Select.Trigger>
              <Select.Content>
                {banks.map((b) => (
                  <Select.Item key={b} value={b}>{b.toUpperCase()}</Select.Item>
                ))}
              </Select.Content>
            </Select>
          </Field>
        )}
        <Field id="doit-expiry" label={t("doit.settings.expires_in")}>
          <Input id="doit-expiry" type="number" min={1} step={1} value={minutes} onChange={(e) => setMinutes(e.target.value)} className="w-40" />
        </Field>
        <Field id="doit-tz" label={t("doit.settings.timezone")} hint={t("doit.settings.timezone_hint")}>
          <Input id="doit-tz" list="doit-tz-list" value={timezone} onChange={(e) => setTimezone(e.target.value)} className="w-64" />
          <datalist id="doit-tz-list">
            {TIMEZONES.map((z) => (
              <option key={z} value={z} />
            ))}
          </datalist>
        </Field>
      </Section>

      <Section title={t("doit.settings.webhook")}>
        <Field id="doit-webhook" label={t("doit.settings.webhook_url")} hint={t("doit.settings.webhook_url_hint")}>
          <div className="flex w-full items-center gap-x-2">
            <div className="min-w-0 flex-1">
              <Input id="doit-webhook" readOnly value={webhookUrl} className="w-full font-mono" />
            </div>
            <Copy content={webhookUrl} variant="mini" aria-label={t("doit.settings.copied")} />
          </div>
        </Field>
      </Section>

      <CreditFooter showCredit={settings.show_credit} />
    </div>
  )
}

export const config = defineRouteConfig({
  label: "doit.id",
})

export default DoitSettingsPage
