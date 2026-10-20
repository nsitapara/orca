import { describe, expect, it } from 'vitest'
import type { KeptHome } from '../../shared/api-types-env'
import type { InboxAddParams } from '../../shared/inbox-types'
import { PilotStore } from '../store/store'
import { createKeptHomecoming, WAIT_NOTICE_MS } from './kept-home'
import type { PilotcliCall, PilotcliReply } from './pilotcli'

const OK: PilotcliReply = { outcome: 'ok', reason: '', data: null, code: 0 }
const reply = (outcome: PilotcliReply['outcome'], reason: string): PilotcliReply => ({
  outcome,
  reason,
  data: null,
  code: outcome === 'skip' ? 3 : 1
})

function setup(replies: PilotcliReply[], opts: { keptHome?: KeptHome; now?: number } = {}) {
  const store = PilotStore.open(':memory:')
  store.runs.create({
    id: 'r1',
    automationId: 'review',
    tickId: null,
    itemKey: 'wt:a',
    itemLabel: 'a',
    worktreePath: '/agents/agents-r1',
    startedAt: 1
  })
  store.runs.envs.begin('r1', '/wt/a', {})
  store.runs.envs.ready('r1', {
    mode: 'throwaway',
    reason: 'uncommitted changes',
    path: '/agents/agents-r1',
    home: '/wt/a',
    worktreeId: 'id',
    sha: null,
    envFile: null,
    vars: {},
    stack: null
  })
  store.runs.update('r1', { status: 'done', finishedAt: 4 })
  store.runs.envs.removed('r1', 5, 'pilot/r1')
  if (opts.keptHome) {
    store.runs.envs.keptHome('r1', opts.keptHome)
  }
  const calls: string[][] = []
  const cards: InboxAddParams[] = []
  const done: string[] = []
  const now = opts.now ?? 1000
  const homecoming = createKeptHomecoming({
    store,
    now: () => now,
    pilotcli: async (call: PilotcliCall) => {
      calls.push([...call.args])
      return replies.shift() ?? OK
    },
    nameOf: (id) => `job ${id}`,
    card: (params) => {
      cards.push(params)
      return `in_${cards.length}`
    },
    cardDone: (id) => {
      done.push(id)
    },
    log: () => {}
  })
  const run = async (): Promise<void> => {
    homecoming.start('r1')
    await homecoming.settled()
  }
  return { store, calls, cards, done, run, keptHome: () => store.runs.get('r1')?.env?.keptHome }
}

const waiting = (over: Partial<KeptHome> = {}): KeptHome => ({
  state: 'waiting',
  reason: null,
  attempts: 0,
  nextAt: null,
  since: 1000,
  noticed: false,
  ...over
})

describe('kept-home', () => {
  it.each<[string, PilotcliReply, Partial<KeptHome>, InboxAddParams['type'] | null]>([
    ['a clean merge lands and deletes the branch', OK, { state: 'merged', nextAt: null }, null],
    [
      'a busy home waits a minute',
      reply('skip', 'uncommitted changes'),
      { state: 'waiting', reason: 'uncommitted changes', nextAt: 61_000 },
      null
    ],
    [
      'a conflict is stuck with a card for an agent',
      reply('skip', 'conflicts in 1 file: a.ts'),
      { state: 'stuck', reason: 'conflicts in 1 file: a.ts', cardId: 'in_1' },
      'left_for_you'
    ],
    [
      'a home that is gone is stuck with a notice',
      reply('invalid', 'no such worktree'),
      { state: 'stuck', reason: 'no such worktree', cardId: 'in_1' },
      'flagged'
    ]
  ])('%s', async (_name, merged, expected, cardType) => {
    const t = setup([merged])
    await t.run()
    expect(t.calls[0]).toEqual([
      'git',
      'update-branch',
      '/wt/a',
      '--merge',
      'true',
      '--to',
      'pilot/r1'
    ])
    expect(t.keptHome()).toMatchObject({ attempts: 1, ...expected })
    expect(t.cards.map((c) => c.type)).toEqual(cardType ? [cardType] : [])
    if (merged.outcome === 'ok') {
      expect(t.calls[1]).toEqual([
        'git',
        'delete-branch',
        'pilot/r1',
        '--kept-in',
        '/wt/a',
        '-C',
        '/wt/a'
      ])
    }
  })

  it('names the branch to merge on a conflict card, on the run', async () => {
    const t = setup([reply('skip', 'conflicts in 1 file: a.ts')])
    await t.run()
    expect(t.cards[0]).toMatchObject({ runId: 'r1', title: 'Merge pilot/r1 into a' })
    expect(t.cards[0].suggested).toContain('Merge pilot/r1 into')
  })

  it("passes another Pilot run's hold on the home as --busy", async () => {
    const t = setup([reply('skip', 'busy')])
    t.store.runs.create({
      id: 'r2',
      automationId: 'qa',
      tickId: null,
      itemKey: 'wt:a',
      itemLabel: 'a',
      worktreePath: '/wt/a',
      startedAt: 10
    })
    await t.run()
    expect(t.calls[0].slice(-2)).toEqual([
      '--busy',
      'job qa is already working in /wt/a (Pilot run r2)'
    ])
  })

  it('leaves one notice for a wait past WAIT_NOTICE_MS', async () => {
    const at = 1000 + WAIT_NOTICE_MS
    const t = setup([reply('skip', 'someone is working there'), reply('skip', 'still')], {
      keptHome: waiting({ attempts: 9 }),
      now: at
    })
    await t.run()
    expect(t.cards.map((c) => c.type)).toEqual(['flagged'])
    expect(t.keptHome()).toMatchObject({
      state: 'waiting',
      noticed: true,
      cardId: 'in_1',
      nextAt: at + 30 * 60_000
    })
    await t.run()
    expect(t.cards).toHaveLength(1)
  })

  it.each<[string, PilotcliReply, Partial<KeptHome>, string[]]>([
    [
      'a stuck branch merged by hand reads merged and closes its card',
      OK,
      { state: 'merged' },
      ['in_1']
    ],
    [
      'a stuck branch not merged yet stays stuck',
      reply('skip', 'not in HEAD; kept'),
      { state: 'stuck' },
      []
    ],
    [
      'a stuck branch deleted by hand is dropped',
      reply('skip', 'no local branch pilot/r1'),
      { state: 'dropped' },
      []
    ]
  ])('%s', async (_name, deleted, expected, closed) => {
    const t = setup([deleted], {
      keptHome: waiting({ state: 'stuck', reason: 'conflicts', cardId: 'in_1' })
    })
    await t.run()
    expect(t.calls).toEqual([
      ['git', 'delete-branch', 'pilot/r1', '--kept-in', '/wt/a', '-C', '/wt/a']
    ])
    expect(t.keptHome()).toMatchObject(expected)
    expect(t.done).toEqual(closed)
  })

  it.each<[string, KeptHome | undefined, number, boolean]>([
    ['never tried', undefined, 1000, true],
    ['waiting and due', waiting({ nextAt: 900 }), 1000, true],
    ['waiting, not due yet', waiting({ nextAt: 2000 }), 1000, false],
    ['stuck and due', waiting({ state: 'stuck', nextAt: 900 }), 1000, true],
    ['merged', waiting({ state: 'merged' }), 1000, false],
    ['dropped', waiting({ state: 'dropped' }), 1000, false]
  ])('keptDue: %s', (_name, keptHome, at, due) => {
    const t = setup([], { keptHome })
    expect(t.store.runs.envs.keptDue(at).map((r) => r.id)).toEqual(due ? ['r1'] : [])
  })
})
