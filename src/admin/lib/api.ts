import { useQuery } from "@tanstack/react-query"
import { useTranslation } from "react-i18next"
import { sdk } from "./client"
import type { PublicSettings, RangeParams } from "./types"

export const doitKeys = {
  settings: ["doit", "settings"] as const,
  stats: (range: RangeParams) => ["doit", "stats", range] as const,
  payments: (params: Record<string, unknown>) => ["doit", "payments", params] as const,
  withdrawals: (params: Record<string, unknown>) => ["doit", "withdrawals", params] as const,
  attention: (params: Record<string, unknown>) => ["doit", "attention", params] as const,
}

/** Builds a query string, dropping empty values. */
export function qs(params: Record<string, unknown>): string {
  const search = new URLSearchParams()
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined || v === null || v === "") continue
    search.set(k, Array.isArray(v) ? v.join(",") : String(v))
  }
  const s = search.toString()
  return s ? `?${s}` : ""
}

export function useDoitSettings() {
  return useQuery({
    queryKey: doitKeys.settings,
    queryFn: () => sdk.client.fetch<{ settings: PublicSettings }>("/admin/doit/settings"),
  })
}

/** Strings for Table.Pagination / DataTable.Pagination in the Admin's language. */
export function usePaginationTranslations() {
  const { t } = useTranslation()
  return {
    of: t("doit.pagination.of"),
    results: t("doit.pagination.results"),
    pages: t("doit.pagination.pages"),
    prev: t("doit.pagination.prev"),
    next: t("doit.pagination.next"),
  }
}
