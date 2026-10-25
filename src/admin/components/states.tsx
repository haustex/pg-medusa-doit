import { Spinner } from "@medusajs/icons"
import { Button, Text } from "@medusajs/ui"
import { useTranslation } from "react-i18next"

export const Loading = () => (
  <div className="flex items-center justify-center p-8">
    <Spinner className="animate-spin text-ui-fg-muted" />
  </div>
)

export const LoadError = ({ onRetry }: { onRetry: () => void }) => {
  const { t } = useTranslation()
  return (
    <div className="flex flex-col items-center gap-y-2 p-8">
      <Text size="small" className="text-ui-fg-error">{t("doit.common.error")}</Text>
      <Button size="small" variant="secondary" onClick={onRetry}>{t("doit.common.retry")}</Button>
    </div>
  )
}

export const Empty = ({ children }: { children: string }) => (
  <div className="flex items-center justify-center px-6 py-10">
    <Text size="small" className="text-ui-fg-muted">{children}</Text>
  </div>
)
