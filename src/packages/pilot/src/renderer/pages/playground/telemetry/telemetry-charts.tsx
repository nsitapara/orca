import type { TelemetryUsage } from '../../../../shared/api-types-telemetry'
import { barSegments, countText, dayText, sparkPoints, type BarSegment } from './telemetry-view'

// The charts are inline SVG: Pilot has no chart library and gets none.

const BAR_HEIGHT = 60
const BAR_STEP = 10
const BAR_WIDTH = 8
// A window this short labels each bar, its calls above it and its day under it; a longer one, its ends and peak.
const DAILY_MAX = 14

export const BAR_FILL: Record<BarSegment['kind'], string> = {
  rest: 'fill-muted-foreground/40',
  failed: 'fill-destructive',
  invalid: 'fill-status-warning'
}
// The legend's swatches, in the bars' colours.
export const BAR_SWATCH: Record<BarSegment['kind'], string> = {
  rest: 'bg-muted-foreground/40',
  failed: 'bg-destructive',
  invalid: 'bg-status-warning'
}

type Series = NonNullable<TelemetryUsage['series']>

function peakOf(buckets: readonly string[], calls: readonly number[]): { n: number; day: string } {
  let best = 0
  for (let i = 1; i < calls.length; i++) {
    if ((calls[i] ?? 0) > (calls[best] ?? 0)) {
      best = i
    }
  }
  return { n: calls[best] ?? 0, day: buckets[best] ?? '' }
}

// Columns that line up with the bars: the SVG stretches each bucket to an equal share of the width.
function columnsOf(n: number): React.CSSProperties {
  return { gridTemplateColumns: `repeat(${n}, minmax(0, 1fr))` }
}

// Each day's calls, above its bar; a screen reader hears the day with it.
function DayTotals({
  buckets,
  calls
}: {
  buckets: readonly string[]
  calls: readonly number[]
}): React.JSX.Element {
  return (
    <ol
      aria-label="Calls each day"
      className="grid text-center font-mono text-[11px] text-muted-foreground"
      style={columnsOf(buckets.length)}
    >
      {buckets.map((b, i) => (
        <li key={b} className="truncate">
          <span className="sr-only">{`${dayText(b)}: `}</span>
          {countText(calls[i])}
        </li>
      ))}
    </ol>
  )
}

// Each day's name, under its bar (the totals above already say it to a screen reader).
function DayLabels({ buckets }: { buckets: readonly string[] }): React.JSX.Element {
  return (
    <div
      aria-hidden
      className="grid text-center text-[11px] text-muted-foreground"
      style={columnsOf(buckets.length)}
    >
      {buckets.map((b) => (
        <span key={b} className="truncate">
          {dayText(b)}
        </span>
      ))}
    </div>
  )
}

// Calls per bucket as stacked bars, ok or skip at the bottom, then failed, then invalid; each bar's title has its counts.
export function DayBars({
  buckets,
  series
}: {
  buckets: readonly string[]
  series: Series
}): React.JSX.Element {
  const first = dayText(buckets[0] ?? '')
  const last = dayText(buckets.at(-1) ?? '')
  const peak = peakOf(buckets, series.calls)
  const peakText = peak.n
    ? `peak ${peak.n.toLocaleString('en-US')} on ${dayText(peak.day)}`
    : 'no calls'
  const daily = buckets.length <= DAILY_MAX
  return (
    <div className="flex flex-col gap-1">
      {daily ? <DayTotals buckets={buckets} calls={series.calls} /> : null}
      <svg
        role="img"
        aria-label={`Calls per day, ${first} to ${last}, ${peakText}`}
        viewBox={`0 0 ${buckets.length * BAR_STEP} ${BAR_HEIGHT}`}
        preserveAspectRatio="none"
        className="h-32 w-full"
      >
        {buckets.map((b, i) => {
          const calls = series.calls[i] ?? 0
          const failed = series.failed[i] ?? 0
          const invalid = series.invalid[i] ?? 0
          return (
            <g key={b} transform={`translate(${i * BAR_STEP} 0)`}>
              <title>{`${b}: ${calls} calls, ${failed} failed, ${invalid} invalid`}</title>
              {/* The whole column takes the hover, so a short bar's title still shows. */}
              <rect x={0} y={0} width={BAR_STEP} height={BAR_HEIGHT} fill="transparent" />
              {barSegments(calls, failed, invalid, peak.n, BAR_HEIGHT).map((s) => (
                <rect
                  key={s.kind}
                  x={(BAR_STEP - BAR_WIDTH) / 2}
                  y={s.y}
                  width={BAR_WIDTH}
                  height={s.height}
                  className={BAR_FILL[s.kind]}
                />
              ))}
            </g>
          )
        })}
      </svg>
      {daily ? (
        <DayLabels buckets={buckets} />
      ) : (
        <div className="flex justify-between gap-2 text-xs text-muted-foreground">
          <span>{first}</span>
          <span>{peakText}</span>
          <span>{last}</span>
        </div>
      )}
    </div>
  )
}

// A command's calls per bucket as a line, for the commands table; nothing for fewer than two buckets.
export function Sparkline({ values }: { values: readonly number[] }): React.JSX.Element | null {
  if (values.length < 2) {
    return null
  }
  return (
    <svg
      aria-hidden
      viewBox="0 0 100 20"
      preserveAspectRatio="none"
      className="block h-5 w-full overflow-visible"
    >
      <polyline
        points={sparkPoints(values)}
        className="stroke-chart-2"
        fill="none"
        strokeWidth={1.5}
        strokeLinejoin="round"
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  )
}
