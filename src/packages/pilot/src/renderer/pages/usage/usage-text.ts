import type { RateLimitState, RateLimitWindow } from '../../../../../../shared/rate-limit-types'
import type { AgentKind } from '../../../shared/definition/types'
import { localDay } from '../../../shared/local-day'
import { relativeTime } from '../../../shared/relative-time'

export const USAGE_PERIODS: readonly { days: number; label: string }[] = [
  { days: 1, label: 'Today' },
  { days: 7, label: '7 days' },
  { days: 30, label: '30 days' }
]
export const AGENTS: readonly AgentKind[] = ['claude', 'codex']
export const AGENT_LABEL: Record<AgentKind, string> = { claude: 'Claude', codex: 'Codex' }
// The theme's chart steps: Claude darker, Codex lighter, the same in every bar and legend.
export const AGENT_BAR: Record<AgentKind, string> = { claude: 'bg-chart-3', codex: 'bg-chart-1' }

// The local day an agent's weekly window began: its reset less its length. Null until the limits have been read.
export function weekStartDay(window: RateLimitWindow | null | undefined): string | null {
  if (!window?.resetsAt) {
    return null
  }
  return localDay(window.resetsAt - window.windowMinutes * 60_000)
}

export function resetDaysOf(limits: RateLimitState): Partial<Record<AgentKind, string>> {
  const days: Partial<Record<AgentKind, string>> = {}
  for (const agent of AGENTS) {
    const day = weekStartDay(limits[agent]?.weekly)
    if (day) {
      days[agent] = day
    }
  }
  return days
}

// "Tue 2:21 AM": when a window resets, close enough to plan around.
export function resetText(window: RateLimitWindow): string {
  if (!window.resetsAt) {
    return window.resetDescription ? `resets ${window.resetDescription}` : ''
  }
  const at = new Date(window.resetsAt).toLocaleString(undefined, {
    weekday: 'short',
    hour: 'numeric',
    minute: '2-digit'
  })
  return `resets ${at}`
}

// A part's share of a whole as a whole percent; empty when there is no whole to share.
export function shareText(part: number | null, whole: number | null): string {
  if (part === null || whole === null || whole <= 0) {
    return ''
  }
  return `${Math.round((part / whole) * 100)}%`
}

export function sharePercent(part: number | null, whole: number | null): number {
  if (part === null || whole === null || whole <= 0) {
    return 0
  }
  return Math.min(100, (part / whole) * 100)
}

// "Oct 20" for a YYYY-MM-DD day; noon keeps it on that day in any time zone.
export function dayLabel(day: string): string {
  const parsed = new Date(`${day}T12:00:00`)
  if (Number.isNaN(parsed.getTime())) {
    return day
  }
  return parsed.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}

export function periodLabel(days: number): string {
  return USAGE_PERIODS.find((p) => p.days === days)?.label ?? `${days} days`
}

const DAY_MS = 86_400_000

// "3 h ago" within a day, else "Oct 16, 9:02 AM".
export function whenText(ms: number, now: number): string {
  if (now - ms < DAY_MS) {
    return relativeTime(ms, now)
  }
  return new Date(ms).toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit'
  })
}
