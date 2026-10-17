import type { ActivityRun, ListedRun } from '../../shared/api-types-runs'
import type { InboxListRow } from '../../shared/api-types'
import type {
  AnswerState,
  CardHistoryEntry,
  InboxListPayload,
  QueueEntry,
  QueueListPayload,
  RunLine
} from '../../shared/inbox-types'
import type { DoneRun } from '../../shared/visibility-types'
import { waitingCount } from '../pages/waiting/answer-text'
import type { HostRead } from './host-poll'
import { hostedKey, type Hosted, type PilotHostEntry, type PilotHostRef } from './pilot-host'

export type MergedInbox = {
  items: Hosted<InboxListRow>[]
  runLines: ReadonlyMap<string, RunLine>
  answerStates: ReadonlyMap<string, AnswerState>
  // Keyed hostedKey(host, runId).
  runs: ReadonlyMap<string, Hosted<ActivityRun>>
  // Keyed hostedKey(host, cardId).
  history: ReadonlyMap<string, CardHistoryEntry[]>
  people: InboxListPayload['people']
  groups: InboxListPayload['groups']
  automations: InboxListPayload['automations']
}

type Answered<T> = { host: PilotHostRef; value: T }

function refOf(host: PilotHostEntry): PilotHostRef {
  return { key: host.key, target: host.target, machineName: host.machineName, local: host.local }
}

// Only an online host with a value counts; this machine comes first, the rest keep host order.
function answered<T>(reads: readonly HostRead<T>[]): Answered<T>[] {
  const live = reads.flatMap((r) =>
    r.value !== null && r.host.state === 'online' ? [{ host: refOf(r.host), value: r.value }] : []
  )
  return [...live.filter((r) => r.host.local), ...live.filter((r) => !r.host.local)]
}

function joinById<T extends { id: string }>(lists: readonly T[][], join?: (a: T, b: T) => T): T[] {
  const byId = new Map<string, T>()
  for (const item of lists.flat()) {
    const seen = byId.get(item.id)
    byId.set(item.id, seen && join ? join(seen, item) : (seen ?? item))
  }
  return [...byId.values()]
}

function tagged<V>(sources: readonly Answered<Record<string, V> | undefined>[]): Map<string, V> {
  const out = new Map<string, V>()
  for (const { host, value } of sources) {
    for (const [id, v] of Object.entries(value ?? {})) {
      out.set(hostedKey(host, id), v)
    }
  }
  return out
}

export function mergeInbox(reads: readonly HostRead<InboxListPayload>[]): MergedInbox | null {
  const got = answered(reads)
  if (got.length === 0) {
    return null
  }
  const runs = new Map<string, Hosted<ActivityRun>>()
  for (const { host, value } of got) {
    for (const [id, run] of Object.entries(value.runs ?? {})) {
      runs.set(hostedKey(host, id), { ...run, host })
    }
  }
  return {
    items: got.flatMap(({ host, value }) => value.items.map((item) => ({ ...item, host }))),
    runLines: tagged(got.map(({ host, value }) => ({ host, value: value.runLines }))),
    answerStates: tagged(got.map(({ host, value }) => ({ host, value: value.answerStates }))),
    runs,
    history: tagged(got.map(({ host, value }) => ({ host, value: value.history }))),
    people: joinById(got.map((g) => g.value.people)),
    groups: joinById(
      got.map((g) => g.value.groups),
      (a, b) => ({ ...a, members: [...new Set([...a.members, ...b.members])] })
    ),
    automations: joinById(got.map((g) => g.value.automations))
  }
}

export function mergeQueue(reads: readonly HostRead<QueueListPayload>[]): Hosted<QueueEntry>[] {
  return answered(reads).flatMap(({ host, value }) =>
    value.entries.map((entry) => ({ ...entry, host }))
  )
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

// A well-formed row: an object whose run has a string id, with effects and defaults lists.
export function isDoneRun(value: unknown): value is DoneRun {
  if (!isRecord(value) || !isRecord(value.run)) {
    return false
  }
  return (
    typeof value.run.id === 'string' &&
    Array.isArray(value.effects) &&
    Array.isArray(value.defaults)
  )
}

export function mergeDoneForYou(
  reads: readonly HostRead<unknown>[]
): (DoneRun & { run: Hosted<ListedRun> })[] {
  return answered(reads).flatMap(({ host, value }) =>
    Array.isArray(value)
      ? value.filter(isDoneRun).map((row) => ({ ...row, run: { ...row.run, host } }))
      : []
  )
}

export function waitingTotal(reads: readonly HostRead<InboxListPayload>[]): number {
  return answered(reads).reduce((sum, { value }) => sum + waitingCount(value.items), 0)
}
