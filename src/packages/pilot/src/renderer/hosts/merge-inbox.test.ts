import { describe, expect, it } from 'vitest'
import type { InboxListRow } from '../../shared/api-types'
import type { ActivityRun, ListedRun } from '../../shared/api-types-runs'
import type { InboxListPayload, QueueEntry } from '../../shared/inbox-types'
import { LOCAL_NAMED, MINI, MINI_OFFLINE } from './__fixtures__/hosts'
import type { HostRead } from './host-poll'
import { isDoneRun, mergeDoneForYou, mergeInbox, mergeQueue, waitingTotal } from './merge-inbox'
import { hostedKey, type PilotHostEntry } from './pilot-host'

function read<T>(host: PilotHostEntry, value: T | null): HostRead<T> {
  return { host, value, error: null, seq: 1, startedSeq: 1 }
}

function row(id: string, runId: string): InboxListRow {
  return {
    id,
    automationId: 'tests',
    runId,
    stepIdx: 0,
    itemKey: null,
    worktreePath: null,
    person: 'nish',
    type: 'question',
    title: 't',
    context: '',
    options: [],
    suggested: null,
    detailsMd: null,
    details: null,
    action: null,
    actionArgs: null,
    parts: {},
    switchWords: [],
    digest: 'd1',
    version: 1,
    status: 'open',
    answer: null,
    answeredAt: null,
    answeredBy: null,
    replies: [],
    outcome: null,
    createdAt: 1,
    updatedAt: 1,
    source: 'engine',
    vaultRef: null
  }
}

function activityRun(id: string): ActivityRun {
  return {
    id,
    automationId: 'tests',
    tickId: null,
    itemKey: 'k',
    itemLabel: 'k',
    worktreePath: null,
    status: 'running',
    outcome: null,
    startedAt: 1,
    finishedAt: null,
    costUsd: null,
    tokens: null,
    worktreeId: null,
    trigger: 'schedule',
    parentRunId: null,
    imported: false,
    steps: [],
    inbox: []
  }
}

function inbox(id: string, runId: string, over: Partial<InboxListPayload> = {}): InboxListPayload {
  return {
    items: [row(id, runId)],
    runLines: { [id]: { digest: 'd1', text: 'run it' } },
    answerStates: {
      [id]: { locked: false, sentBeforePilot: false, state: null, readyAt: null, reason: null }
    },
    runs: { [runId]: activityRun(runId) },
    history: { [id]: [{ kind: 'asked', at: 1, run: null }] },
    people: [{ id: 'nish', name: 'Nish' }],
    groups: [],
    automations: [{ id: 'tests', name: 'Tests' }],
    ...over
  }
}

describe('mergeInbox', () => {
  it('tags each card, run line, answer state and run with its own machine, even when two machines use the same ids', () => {
    const m = mergeInbox([read(LOCAL_NAMED, inbox('in_1', 'r1')), read(MINI, inbox('in_1', 'r1'))])!
    expect(m.items.map((i) => i.host.key)).toEqual(['local', 'env:mini'])
    expect(m.runs.get(hostedKey(MINI, 'r1'))?.host.key).toBe('env:mini')
    expect(m.runLines.has('in_1') && m.runLines.has(hostedKey(MINI, 'in_1'))).toBe(true)
    expect(m.answerStates.has('in_1') && m.answerStates.has(hostedKey(MINI, 'in_1'))).toBe(true)
    expect(m.history.has(hostedKey(MINI, 'in_1'))).toBe(true)
  })

  it("joins people, groups and automations by id, this machine's first", () => {
    const mini = inbox('in_2', 'r2', {
      people: [
        { id: 'nish', name: 'Nish (mini)' },
        { id: 'sam', name: 'Sam' }
      ],
      groups: [{ id: 'g', name: 'G', members: ['sam'] }],
      automations: [{ id: 'tests', name: 'Tests mini' }]
    })
    const local = inbox('in_1', 'r1', { groups: [{ id: 'g', name: 'G', members: ['nish'] }] })
    const m = mergeInbox([read(MINI, mini), read(LOCAL_NAMED, local)])!
    expect(m.items.map((i) => i.host.key)).toEqual(['local', 'env:mini'])
    expect(m.people).toEqual([
      { id: 'nish', name: 'Nish' },
      { id: 'sam', name: 'Sam' }
    ])
    expect(m.groups).toEqual([{ id: 'g', name: 'G', members: ['nish', 'sam'] }])
    expect(m.automations).toEqual([{ id: 'tests', name: 'Tests' }])
  })

  it('is null until a host has answered, and leaves out a host with no read', () => {
    expect(mergeInbox([])).toBeNull()
    expect(mergeInbox([read<InboxListPayload>(MINI, null)])).toBeNull()
    const m = mergeInbox([
      read(LOCAL_NAMED, inbox('in_1', 'r1')),
      read<InboxListPayload>(MINI, null)
    ])!
    expect(m.items.map((i) => i.host.key)).toEqual(['local'])
    expect(mergeInbox([read(MINI_OFFLINE, inbox('in_1', 'r1'))])).toBeNull()
  })
})

describe('waitingTotal', () => {
  it('adds the open cards of every machine that answered', () => {
    expect(
      waitingTotal([
        read(LOCAL_NAMED, inbox('a', 'r1')),
        read(MINI, inbox('a', 'r1')),
        read<InboxListPayload>(MINI_OFFLINE, null)
      ])
    ).toBe(2)
  })
})

describe('mergeQueue', () => {
  it('tags each entry with its machine', () => {
    const entry: QueueEntry = {
      rowId: 1,
      itemId: 'in_1',
      title: 't',
      type: 'question',
      automationId: 'tests',
      automationName: 'Tests',
      worktreePath: null,
      person: 'nish',
      answer: 'a',
      state: 'ready',
      holdReason: null,
      holdDetail: null,
      readyAt: 1,
      how: 'tick',
      fires: 'now',
      updatedAt: 1
    }
    const merged = mergeQueue([
      read(LOCAL_NAMED, { entries: [entry] }),
      read(MINI, { entries: [entry] })
    ])
    expect(merged.map((e) => e.host.key)).toEqual(['local', 'env:mini'])
  })
})

describe('mergeDoneForYou', () => {
  it('keeps only well-formed Done for you rows from each host and tags each run', () => {
    const run: ListedRun = { ...activityRun('r1'), fields: {} }
    const good = { run, effects: [], defaults: [] }
    const merged = mergeDoneForYou([
      read<unknown>(LOCAL_NAMED, [good, { run: {}, effects: [], defaults: [] }, null, 'x']),
      read<unknown>(MINI, [good]),
      read<unknown>(MINI_OFFLINE, null),
      read<unknown>(MINI, { not: 'a list' })
    ])
    expect(merged.map((d) => d.run.host.key)).toEqual(['local', 'env:mini'])
    expect(isDoneRun(good)).toBe(true)
    expect(isDoneRun({ run: { id: 3 }, effects: [], defaults: [] })).toBe(false)
  })
})
