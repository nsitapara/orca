import type { AutomationSummary } from '../../shared/api-types'
import { jobEnabled, jobLastTick, type ListEntry } from '../../shared/job-stages'

export type SortColumn = 'name' | 'looksAt' | 'schedule' | 'lastTick' | 'status'
export type SortDirection = 'asc' | 'desc'
export type SortState = { column: SortColumn; direction: SortDirection }

export const DEFAULT_SORT: SortState = { column: 'name', direction: 'asc' }
const SORT_KEY = 'pilot.automations.sort'
const COLUMNS: readonly SortColumn[] = ['name', 'looksAt', 'schedule', 'lastTick', 'status']

export type JobCode = { prefix: string; number: number }

// "13 · Fix e2e" -> {'' , 13}; "M04 · Docs" -> {'M', 4}; no leading code -> null.
export function codeOf(name: string): JobCode | null {
  const m = /^([A-Za-z]*)(\d+)\b/.exec(name)
  return m ? { prefix: m[1].toUpperCase(), number: Number(m[2]) } : null
}

function entryName(e: ListEntry): string {
  return e.kind === 'job' ? `${e.id} · ${e.name}` : e.automation.name
}

function compareText(a: string, b: string): number {
  return a.localeCompare(b, undefined, { sensitivity: 'base' })
}

// Numeric codes, then letter prefixes (by prefix, then number), then no code (by name).
function compareNatural(a: string, b: string): number {
  const ca = codeOf(a)
  const cb = codeOf(b)
  if (ca && cb) {
    if (ca.prefix !== cb.prefix) {
      if (ca.prefix === '') {
        return -1
      }
      if (cb.prefix === '') {
        return 1
      }
      return compareText(ca.prefix, cb.prefix)
    }
    return ca.number - cb.number || compareText(a, b)
  }
  if (ca) {
    return -1
  }
  if (cb) {
    return 1
  }
  return compareText(a, b)
}

function stagesOf(e: ListEntry): AutomationSummary[] {
  return e.kind === 'job' ? e.stages : [e.automation]
}

// Schedule rank: 0 = has a next run time, 1 = only schedule text, 2 = run by hand (always last).
function scheduleKey(e: ListEntry): { rank: number; time: number; text: string } {
  const list = stagesOf(e)
  const times = list.map((a) => a.nextTickAt).filter((t): t is number => t !== null)
  if (times.length) {
    return { rank: 0, time: Math.min(...times), text: '' }
  }
  const timed = list.find((a) => a.schedule !== 'manual')
  if (timed) {
    return { rank: 1, time: 0, text: timed.schedule }
  }
  return { rank: 2, time: 0, text: '' }
}

function compareSchedule(a: ListEntry, b: ListEntry, sign: number): number {
  const ka = scheduleKey(a)
  const kb = scheduleKey(b)
  if (ka.rank !== kb.rank) {
    return ka.rank - kb.rank
  }
  if (ka.rank === 0) {
    return sign * (ka.time - kb.time)
  }
  return sign * compareText(ka.text, kb.text)
}

function lastTickAt(e: ListEntry): number | null {
  if (e.kind === 'job') {
    return jobLastTick(e)?.startedAt ?? null
  }
  return e.automation.lastTick?.startedAt ?? null
}

// Most recent first when ascending; never-ticked always last.
function compareLastTick(a: ListEntry, b: ListEntry, sign: number): number {
  const ta = lastTickAt(a)
  const tb = lastTickAt(b)
  if (ta === null || tb === null) {
    return (ta === null ? 1 : 0) - (tb === null ? 1 : 0)
  }
  return sign * (tb - ta)
}

function isEnabled(e: ListEntry): boolean {
  return e.kind === 'job' ? jobEnabled(e) : e.automation.enabled
}

function lookKey(e: ListEntry): string {
  return stagesOf(e)
    .map((a) => a.itemKind)
    .join(' ')
}

function compareBy(a: ListEntry, b: ListEntry, state: SortState): number {
  const sign = state.direction === 'asc' ? 1 : -1
  switch (state.column) {
    case 'name':
      return sign * compareNatural(entryName(a), entryName(b))
    case 'looksAt':
      return sign * compareText(lookKey(a), lookKey(b))
    case 'schedule':
      return compareSchedule(a, b, sign)
    case 'lastTick':
      return compareLastTick(a, b, sign)
    case 'status':
      return sign * (Number(isEnabled(b)) - Number(isEnabled(a)))
  }
}

// A job's stages stay inside it, already in stage order; only the top-level entries move.
export function sortEntries<T extends ListEntry>(entries: readonly T[], state: SortState): T[] {
  return [...entries].sort(
    (a, b) => compareBy(a, b, state) || compareNatural(entryName(a), entryName(b))
  )
}

export function nextSort(current: SortState, column: SortColumn): SortState {
  if (current.column !== column) {
    return { column, direction: 'asc' }
  }
  return { column, direction: current.direction === 'asc' ? 'desc' : 'asc' }
}

function isSortState(v: unknown): v is SortState {
  const s = v as Partial<SortState> | null
  return (
    !!s &&
    COLUMNS.includes(s.column as SortColumn) &&
    (s.direction === 'asc' || s.direction === 'desc')
  )
}

export function loadSort(): SortState {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(SORT_KEY) ?? 'null')
    return isSortState(parsed) ? parsed : DEFAULT_SORT
  } catch {
    return DEFAULT_SORT
  }
}

export function saveSort(state: SortState): void {
  try {
    localStorage.setItem(SORT_KEY, JSON.stringify(state))
  } catch {
    // storage unavailable: the sort just isn't remembered
  }
}

const FOLD_KEY = 'pilot.automations.folded.'

// Folded jobs are remembered per job id; no entry means expanded.
export function loadFolded(jobId: string): boolean {
  try {
    return localStorage.getItem(FOLD_KEY + jobId) === '1'
  } catch {
    return false
  }
}

export function saveFolded(jobId: string, folded: boolean): void {
  try {
    if (folded) {
      localStorage.setItem(FOLD_KEY + jobId, '1')
    } else {
      localStorage.removeItem(FOLD_KEY + jobId)
    }
  } catch {
    // storage unavailable: the fold just isn't remembered
  }
}
