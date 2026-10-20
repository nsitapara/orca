import type { ActivityRun } from '../../shared/api-types-runs'
import type { InboxListRow } from '../../shared/api-types'
import type {
  AnswerState,
  CardHistoryEntry,
  InboxListPayload,
  PreparationWait,
  QueueEntry,
  QueueListPayload,
  RunLine
} from '../../shared/inbox-types'
import { waitingCount } from '../pages/waiting/answer-text'
import { answered, type Answered } from './answered-reads'
import type { HostRead } from './host-poll'
import { hostedKey, type Hosted } from './pilot-host'

export type MergedInbox = {
  items: Hosted<InboxListRow>[]
  runLines: ReadonlyMap<string, RunLine>
  answerStates: ReadonlyMap<string, AnswerState>
  // Keyed hostedKey(host, runId).
  runs: ReadonlyMap<string, Hosted<ActivityRun>>
  // Keyed hostedKey(host, cardId).
  history: ReadonlyMap<string, CardHistoryEntry[]>
  // Keyed hostedKey(host, cardId).
  preparationWaits: ReadonlyMap<string, PreparationWait>
  people: InboxListPayload['people']
  groups: InboxListPayload['groups']
  automations: InboxListPayload['automations']
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
    preparationWaits: tagged(
      got.map(({ host, value }) => ({ host, value: value.preparationWaits }))
    ),
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

export function waitingTotal(reads: readonly HostRead<InboxListPayload>[]): number {
  return answered(reads).reduce((sum, { value }) => sum + waitingCount(value.items), 0)
}

// One machine: its error, as before. Several: only when every machine failed a read; HostsNotice names the rest.
export function mergedError(reads: readonly HostRead<unknown>[]): string | null {
  const hosts = new Set<string>()
  const failed = new Map<string, string>()
  for (const r of reads) {
    hosts.add(r.host.key)
    if (r.error !== null && !failed.has(r.host.key)) {
      failed.set(r.host.key, r.error)
    }
  }
  if (hosts.size === 0 || failed.size < hosts.size) {
    return null
  }
  return [...failed.values()][0] ?? null
}
