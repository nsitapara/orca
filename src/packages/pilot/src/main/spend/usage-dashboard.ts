import type {
  AgentUsage,
  UsageAutomationRow,
  UsageByAgent,
  UsageDashboard,
  UsageDayRow,
  UsageRunRow,
  UsageSinceReset
} from '../../shared/api-types'
import type { AgentKind } from '../../shared/definition/types'
import type { PilotStore } from '../store/store'
import type { UsageRunSliceRow, UsageSliceRow } from '../store/store-spend'
import { localDay } from '../usage/buckets'
import { sinceDayFor } from './spend'

export const MAX_USAGE_DAYS = 90
const AGENTS: readonly AgentKind[] = ['claude', 'codex']
const TOP_RUNS = 10

// resetDays: the local day each agent's weekly limit last reset (the renderer reads it from the rate limits).
export type UsageDashboardParams = {
  days: number
  resetDays?: Partial<Record<AgentKind, string>>
}
type NameOf = (automationId: string) => string

function noUsage(): UsageByAgent {
  return { claude: { tokens: 0, costUsd: null }, codex: { tokens: 0, costUsd: null } }
}

// As SQL's SUM: an unpriced bucket adds nothing, and a cost stays null until one bucket is priced.
function add(into: AgentUsage, row: AgentUsage): void {
  into.tokens += row.tokens
  if (row.costUsd !== null) {
    into.costUsd = (into.costUsd ?? 0) + row.costUsd
  }
}

function totalOf(byAgent: UsageByAgent): AgentUsage {
  const total: AgentUsage = { tokens: 0, costUsd: null }
  for (const agent of AGENTS) {
    add(total, byAgent[agent])
  }
  return total
}

// Most expensive first; tokens break a tie (an unpriced model has no cost).
function byCost(a: AgentUsage, b: AgentUsage): number {
  return (b.costUsd ?? 0) - (a.costUsd ?? 0) || b.tokens - a.tokens
}

function daysBetween(first: string, last: string): string[] {
  const [y, m, d] = first.split('-').map(Number)
  const days: string[] = []
  for (let i = 0; ; i++) {
    const day = localDay(new Date(y, m - 1, d + i).getTime())
    if (day > last) {
      return days
    }
    days.push(day)
  }
}

function usageByAutomation(slices: readonly UsageSliceRow[]): Map<string, UsageByAgent> {
  const rows = new Map<string, UsageByAgent>()
  for (const s of slices) {
    const byAgent = rows.get(s.automationId) ?? noUsage()
    add(byAgent[s.agent], s)
    rows.set(s.automationId, byAgent)
  }
  return rows
}

function runRows(slices: readonly UsageRunSliceRow[], nameOf: NameOf): UsageRunRow[] {
  const runs = new Map<string, UsageRunRow>()
  for (const s of slices) {
    const run = runs.get(s.runId) ?? {
      runId: s.runId,
      automationId: s.automationId,
      name: nameOf(s.automationId),
      itemLabel: s.itemLabel,
      startedAt: s.startedAt,
      status: s.status,
      tokens: 0,
      costUsd: null,
      byAgent: noUsage()
    }
    add(run.byAgent[s.agent], s)
    add(run, s)
    runs.set(s.runId, run)
  }
  return [...runs.values()]
}

function automationRows(
  slices: readonly UsageSliceRow[],
  runs: readonly UsageRunRow[],
  nameOf: NameOf
): UsageAutomationRow[] {
  const runCount = new Map<string, number>()
  for (const run of runs) {
    runCount.set(run.automationId, (runCount.get(run.automationId) ?? 0) + 1)
  }
  return [...usageByAutomation(slices)]
    .map(([automationId, byAgent]) => ({
      automationId,
      name: nameOf(automationId),
      runs: runCount.get(automationId) ?? 0,
      ...totalOf(byAgent),
      byAgent
    }))
    .sort(byCost)
}

function dailyRows(
  slices: readonly UsageSliceRow[],
  sinceDay: string,
  today: string
): UsageDayRow[] {
  const days = new Map(daysBetween(sinceDay, today).map((day) => [day, noUsage()] as const))
  for (const s of slices) {
    const byAgent = days.get(s.day)
    if (byAgent) {
      add(byAgent[s.agent], s)
    }
  }
  return [...days].map(([day, byAgent]) => ({ day, byAgent }))
}

function sinceReset(
  slices: readonly UsageSliceRow[],
  agent: AgentKind,
  sinceDay: string,
  nameOf: NameOf
): UsageSinceReset {
  const mine = slices.filter((s) => s.agent === agent && s.day >= sinceDay)
  const automations = [...usageByAutomation(mine)]
    .map(([automationId, byAgent]) => ({
      automationId,
      name: nameOf(automationId),
      ...byAgent[agent]
    }))
    .filter((a) => a.tokens > 0)
    .sort(byCost)
  const total: AgentUsage = { tokens: 0, costUsd: null }
  for (const a of automations) {
    add(total, a)
  }
  return { sinceDay, total, automations }
}

export function usageDashboard(
  store: PilotStore,
  names: ReadonlyMap<string, string>,
  params: UsageDashboardParams,
  now: number
): UsageDashboard {
  const nameOf: NameOf = (id) => names.get(id) ?? id
  const sinceDay = sinceDayFor(params.days, now)
  const resets = AGENTS.flatMap((agent) => {
    const day = params.resetDays?.[agent]
    return day ? [{ agent, day }] : []
  })
  const earliest = resets.reduce((min, r) => (r.day < min ? r.day : min), sinceDay)
  const allSlices = store.spend.usageSlices(earliest)
  const slices = allSlices.filter((s) => s.day >= sinceDay)
  const runs = runRows(store.spend.usageRunSlices(sinceDay), nameOf)
  const byAgent = noUsage()
  for (const s of slices) {
    add(byAgent[s.agent], s)
  }
  return {
    days: params.days,
    sinceDay,
    total: { runs: runs.length, ...totalOf(byAgent), byAgent },
    automations: automationRows(slices, runs, nameOf),
    daily: dailyRows(slices, sinceDay, localDay(now)),
    topRuns: [...runs].sort(byCost).slice(0, TOP_RUNS),
    sinceReset: Object.fromEntries(
      resets.map((r) => [r.agent, sinceReset(allSlices, r.agent, r.day, nameOf)])
    ),
    pendingSteps: store.spend.pendingAgentSteps(),
    measuredAt: store.usage.lastMeasuredAt()
  }
}
