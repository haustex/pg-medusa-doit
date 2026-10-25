import { Text } from "@medusajs/ui"
import { useTranslation } from "react-i18next"
import {
  CREDIT_URL,
  DISCLAIMER,
  PLUGIN_DISPLAY_NAME,
  SUPPORT_WHATSAPP_URL,
} from "../lib/branding"

type CreditFooterProps = {
  /** `show_credit` from GET /admin/doit/settings (plugin option `showCredit`). */
  showCredit: boolean
}

const linkClassName = "text-ui-fg-subtle hover:text-ui-fg-base transition-fg"

/**
 * Footer for the plugin's own Admin pages. The disclaimer is always shown;
 * the credit and support link can be turned off with `showCredit: false`.
 */
export const CreditFooter = ({ showCredit }: CreditFooterProps) => {
  const { t } = useTranslation()
  return (
    <div className="flex flex-wrap items-center justify-between gap-2 px-6 py-4">
      <Text size="xsmall" leading="compact" className="text-ui-fg-muted">
        {DISCLAIMER}
      </Text>
      {showCredit && (
        <Text size="xsmall" leading="compact" className="text-ui-fg-muted">
          <a href={CREDIT_URL} target="_blank" rel="noopener noreferrer" className={linkClassName}>
            {PLUGIN_DISPLAY_NAME} · by Haus Kayu
          </a>
          {" · "}
          <a
            href={SUPPORT_WHATSAPP_URL}
            target="_blank"
            rel="noopener noreferrer"
            className={linkClassName}
          >
            {t("doit.footer.help", { defaultValue: "Bantuan" })}
          </a>
        </Text>
      )}
    </div>
  )
}
