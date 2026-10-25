import { Text } from "@medusajs/ui"
import { useState } from "react"
import { useTranslation } from "react-i18next"
import { useAccent } from "../lib/accent"
import { formatCompactRupiah, formatDay, formatNumber, formatRupiah, localeOf } from "../lib/format"

type Point = { date: string; count: number; gross: number; net: number }

const WIDTH = 720
const HEIGHT = 200
const PAD = { top: 12, right: 8, bottom: 24, left: 56 }

/**
 * Plain SVG: gross as bars (teak accent), net as a line. One bar per local
 * day, already zero-filled by the server.
 */
export const DailyChart = ({ series }: { series: Point[] }) => {
  const { t, i18n } = useTranslation()
  const locale = localeOf(i18n.language)
  const accent = useAccent()
  const [hover, setHover] = useState<number | null>(null)

  const max = Math.max(1, ...series.map((p) => p.gross))
  const innerW = WIDTH - PAD.left - PAD.right
  const innerH = HEIGHT - PAD.top - PAD.bottom
  const step = innerW / Math.max(1, series.length)
  const barW = Math.max(2, Math.min(28, step * 0.7))
  const y = (v: number) => PAD.top + innerH - (v / max) * innerH
  const x = (i: number) => PAD.left + step * i + step / 2
  const labelEvery = Math.max(1, Math.ceil(series.length / 8))
  const empty = series.every((p) => p.count === 0)
  const netPath = series.map((p, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(p.net).toFixed(1)}`).join(" ")
  const active = hover !== null ? series[hover] : null

  return (
    <div className="flex flex-col gap-y-2">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-x-3">
          <span className="flex items-center gap-x-1">
            <span className="inline-block size-2 rounded-sm" style={{ background: accent.color }} />
            <Text size="xsmall" className="text-ui-fg-subtle">{t("doit.chart.gross")}</Text>
          </span>
          <span className="flex items-center gap-x-1">
            <span className="inline-block h-0.5 w-3 bg-ui-fg-base" />
            <Text size="xsmall" className="text-ui-fg-subtle">{t("doit.chart.net")}</Text>
          </span>
        </div>
        <Text size="xsmall" className="text-ui-fg-muted tabular-nums" aria-live="polite">
          {active
            ? t("doit.chart.tooltip", {
                date: formatDay(active.date, locale),
                n: formatNumber(active.count),
                gross: formatRupiah(active.gross),
                net: formatRupiah(active.net),
              })
            : " "}
        </Text>
      </div>
      <div className="relative">
        <svg viewBox={`0 0 ${WIDTH} ${HEIGHT}`} className="h-auto w-full" role="img" aria-label={t("doit.chart.title")}>
          {[0, 0.5, 1].map((f) => (
            <g key={f}>
              <line x1={PAD.left} x2={WIDTH - PAD.right} y1={y(max * f)} y2={y(max * f)} className="stroke-ui-border-base" strokeDasharray={f ? "3 3" : undefined} />
              <text x={PAD.left - 6} y={y(max * f) + 3} textAnchor="end" className="fill-ui-fg-muted" fontSize="10">
                {formatCompactRupiah(max * f)}
              </text>
            </g>
          ))}
          {series.map((p, i) => (
            <g key={p.date} onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)}>
              <rect x={PAD.left + step * i} y={PAD.top} width={step} height={innerH} fill="transparent" />
              <rect
                x={x(i) - barW / 2}
                y={y(p.gross)}
                width={barW}
                height={Math.max(0, PAD.top + innerH - y(p.gross))}
                rx={2}
                fill={accent.color}
                opacity={hover === null || hover === i ? 1 : 0.5}
              >
                <title>
                  {t("doit.chart.tooltip", { date: formatDay(p.date, locale), n: formatNumber(p.count), gross: formatRupiah(p.gross), net: formatRupiah(p.net) })}
                </title>
              </rect>
              {i % labelEvery === 0 && (
                <text x={x(i)} y={HEIGHT - 6} textAnchor="middle" className="fill-ui-fg-muted" fontSize="10">
                  {formatDay(p.date, locale)}
                </text>
              )}
            </g>
          ))}
          {series.length > 1 && <path d={netPath} fill="none" className="stroke-ui-fg-base" strokeWidth={1.5} pointerEvents="none" />}
        </svg>
        {empty && (
          <div className="absolute inset-0 flex items-center justify-center">
            <Text size="small" className="text-ui-fg-muted">{t("doit.chart.empty")}</Text>
          </div>
        )}
      </div>
    </div>
  )
}
