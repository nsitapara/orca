import type { ActivityRun } from '../../shared/api-types-runs'
import type { AutomationListPayload, AutomationSummary } from '../../shared/api-types'
import { newestTick } from '../../shared/job-stages'
import { sameMachine } from '../../shared/machine-match'
import { answered, refOf, type AnsweredRead } from './answered-reads'
import { createHostPoller, type HostRead } from './host-poll'
import { LOCAL_PILOT_HOST, type Hosted, type PilotHostEntry, type PilotHostRef } from './pilot-host'
import { withPilotHosts } from './pilot-hosts-feed'

export const AUTOMATIONS_LIST = 'pilot.automations.list'

// Omits live so its runs read as tagged; it still fits wherever an AutomationSummary goes.
export type MergedAutomation = Omit<AutomationSummary, 'live'> & {
  host: PilotHostRef
  hosts: PilotHostRef[]
  live: Hosted<ActivityRun>[]
}
export type MergedAutomationList = Omit<AutomationListPayload, 'automations'> & {
  automations: MergedAutomation[]
}
// The listed machines as a page last read their lists, for the rule that refuses a row's actions.
export type ListedMachines = {
  listedHosts: readonly PilotHostRef[]
  failedHosts: readonly PilotHostRef[]
  // Keys of the failed ones that haven't answered a list read yet.
  pendingHosts?: ReadonlySet<string>
}
export type LoadedAutomations = MergedAutomationList & {
  listedHosts: PilotHostRef[]
  // Every listed machine whose list isn't in it: offline, or its read failed.
  failedHosts: PilotHostRef[]
}

type HostedSummary = { host: PilotHostEntry; summary: AutomationSummary }
type Problems = Omit<AutomationListPayload, 'automations'>

function namedRow(rows: readonly HostedSummary[]): HostedSummary | undefined {
  for (const { summary } of rows) {
    const name = summary.runsOn
    const named = name ? rows.find((r) => sameMachine(r.host.machineName, name)) : undefined
    if (named) {
      return named
    }
  }
  return undefined
}

// Older hosts say neither ticksHere nor runsOn, so their rows fall through to this machine.
function homeRow(rows: readonly HostedSummary[]): HostedSummary | undefined {
  return (
    rows.find((r) => r.summary.ticksHere) ??
    namedRow(rows) ??
    rows.find((r) => r.host.local) ??
    rows.at(0)
  )
}

export function homeHost(rows: readonly HostedSummary[]): PilotHostEntry {
  return homeRow(rows)?.host ?? LOCAL_PILOT_HOST
}

function mergeRow(first: HostedSummary, rows: readonly HostedSummary[]): MergedAutomation {
  const home = homeRow(rows) ?? first
  return {
    ...home.summary,
    host: refOf(home.host),
    hosts: rows.map((r) => refOf(r.host)),
    live: rows.flatMap((r) => r.summary.live.map((run) => ({ ...run, host: refOf(r.host) }))),
    lastTick: newestTick(rows.map((r) => r.summary))
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function isListPayload(value: unknown): value is AutomationListPayload {
  return (
    isRecord(value) &&
    Array.isArray(value.automations) &&
    Array.isArray(value.errors) &&
    Array.isArray(value.missingDirs)
  )
}

// With several machines each problem names its machine, still ahead of its file so ProblemNotices strips that once.
function problemsOf(got: readonly AnsweredRead<AutomationListPayload>[]): Problems {
  const named = got.length > 1
  const on = (host: PilotHostRef, text: string): string =>
    named ? `${host.machineName}: ${text}` : text
  const lines = (host: PilotHostRef, file: string, list: readonly string[]): string[] =>
    list.map((line) => (line.startsWith(`${file}: `) ? on(host, line) : line))
  const people = got.flatMap(({ host, value }) =>
    value.peopleError ? [on(host, value.peopleError)] : []
  )
  return {
    errors: got.flatMap(({ host, value }) =>
      value.errors.map((e) => ({ file: on(host, e.file), errors: lines(host, e.file, e.errors) }))
    ),
    warnings: got.flatMap(({ host, value }) =>
      (value.warnings ?? []).map((w) => ({
        file: on(host, w.file),
        warnings: lines(host, w.file, w.warnings)
      }))
    ),
    peopleError: people.length ? people.join(' · ') : null,
    missingDirs: got.flatMap(({ host, value }) => value.missingDirs.map((dir) => on(host, dir))),
    unmergedFixes: got.reduce((sum, { value }) => sum + (value.unmergedFixes ?? 0), 0)
  }
}

function listsOf(
  reads: readonly HostRead<AutomationListPayload>[]
): AnsweredRead<AutomationListPayload>[] {
  return answered(reads).filter((r) => isListPayload(r.value))
}

// Every listed machine whose list can't be relied on right now: offline, not yet read, or its latest read failed.
export function failedHostsOf(
  reads: readonly HostRead<AutomationListPayload>[],
  hosts: readonly PilotHostEntry[]
): PilotHostRef[] {
  const got = new Set(listsOf(reads.filter((r) => r.error === null)).map((r) => r.host.key))
  const failed = new Map<string, PilotHostEntry>()
  for (const host of [...reads.map((r) => r.host), ...hosts]) {
    if (!got.has(host.key) && !failed.has(host.key)) {
      failed.set(host.key, host)
    }
  }
  return [...failed.values()].map(refOf)
}

// Listed machines online that haven't answered a list read yet: no error, no list.
export function pendingHostsOf(
  reads: readonly HostRead<AutomationListPayload>[],
  hosts: readonly PilotHostEntry[]
): Set<string> {
  const byKey = new Map(reads.map((r) => [r.host.key, r]))
  const pending = hosts.filter((host) => {
    const read = byKey.get(host.key)
    return (
      host.state === 'online' && (read?.value ?? null) === null && (read?.error ?? null) === null
    )
  })
  return new Set(pending.map((host) => host.key))
}

export function mergeAutomationLists(
  reads: readonly HostRead<AutomationListPayload>[]
): MergedAutomationList | null {
  const got = listsOf(reads)
  if (got.length === 0) {
    return null
  }
  const byId = new Map<string, HostedSummary[]>()
  for (const { entry, value } of got) {
    for (const summary of value.automations) {
      byId.set(summary.id, [...(byId.get(summary.id) ?? []), { host: entry, summary }])
    }
  }
  return {
    ...problemsOf(got),
    automations: [...byId.values()].map((rows) => mergeRow(rows[0], rows))
  }
}

// Every machine's list as of now, for an action that must first find a row's home machine.
export function loadMergedAutomations(): Promise<LoadedAutomations> {
  return withPilotHosts(async (hosts) => {
    const poller = createHostPoller<AutomationListPayload>({
      method: AUTOMATIONS_LIST,
      // Stopped once its one read per machine is in, so this never ticks.
      intervalMs: 60_000,
      onChange: () => {}
    })
    try {
      await poller.refresh()
    } finally {
      poller.stop()
    }
    const reads = poller.reads()
    const merged = mergeAutomationLists(reads)
    if (!merged) {
      throw new Error(reads.find((r) => r.error !== null)?.error ?? 'No Pilot answered')
    }
    return { ...merged, listedHosts: hosts.map(refOf), failedHosts: failedHostsOf(reads, hosts) }
  })
}
