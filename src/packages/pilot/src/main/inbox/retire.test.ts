import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { parseAutomationYaml } from '../../shared/definition/parse'
import { parsePeopleYaml } from '../../shared/people'
import type { GlabApi } from '../sources/gitlab-api'
import { PilotStore } from '../store/store'
import { addInboxItem } from './inbox-add'
import type { InboxDeps } from './inbox-service'
import { InboxRetirer, MR_CACHE_MS, retireTarget } from './retire'

const def = parseAutomationYaml(
  'name: Fix CI\nrepo: web-platform\nschedule: manual\nitems: { kind: merge_request }\nsteps: [ { agent: claude, prompt: x } ]\ninbox: nish\n',
  '/a/ci.yaml'
)
const people = parsePeopleYaml('people:\n  - { id: nish, name: Nish, gitlab: nish8 }\n')
if (!def.ok || !people.ok) {
  throw new Error('setup')
}

function setup(state: () => string | Error) {
  const store = PilotStore.open(join(mkdtempSync(join(tmpdir(), 'pilot-retire-')), 'db.sqlite'))
  store.runs.create({
    id: 'run-1',
    automationId: 'ci',
    tickId: null,
    itemKey: 'mr:1561',
    itemLabel: '!1561',
    worktreePath: '/wt/1493',
    startedAt: 1
  })
  let clock = 1000
  let n = 0
  const inbox: InboxDeps = {
    store,
    now: () => clock,
    definitions: () => [def.ok ? def.definition : (null as never)],
    people: () => (people.ok ? people.directory : (null as never)),
    newId: () => `in_${String(++n).padStart(16, '0')}`
  }
  const get = vi.fn(async () => {
    const s = state()
    if (s instanceof Error) {
      throw s
    }
    return { iid: 1561, state: s } as never
  })
  const api: GlabApi = { projectPath: 'p', get }
  const retirer = new InboxRetirer({
    inbox,
    repoOf: () => 'web-platform',
    gitlab: async () => api,
    log: () => {}
  })
  return { store, inbox, retirer, get, tick: (ms: number) => (clock += ms) }
}

const CARD = {
  runId: 'run-1',
  type: 'question' as const,
  title: 'Which image?',
  options: ['A', 'B']
}

describe('InboxRetirer', () => {
  it('ticks every open card of a merged MR obsolete, answered or not', async () => {
    const { store, inbox, retirer } = setup(() => 'merged')
    addInboxItem(inbox, CARD)
    addInboxItem(inbox, { ...CARD, title: 'Second?' })
    store.inbox.update('in_0000000000000002', { status: 'answered' }, 1000)
    expect(await retirer.pass()).toBe(2)
    expect(store.inbox.list({}).map((i) => [i.status, i.outcome])).toEqual([
      ['obsolete', 'obsolete: !1561 merged'],
      ['obsolete', 'obsolete: !1561 merged']
    ])
  })

  it('leaves the cards of an open MR alone', async () => {
    const { store, inbox, retirer } = setup(() => 'opened')
    addInboxItem(inbox, CARD)
    expect(await retirer.pass()).toBe(0)
    expect(store.inbox.get('in_0000000000000001')?.status).toBe('open')
  })

  it('asks GitLab at most once per MR every 10 minutes', async () => {
    const { inbox, retirer, get, tick } = setup(() => 'opened')
    addInboxItem(inbox, CARD)
    addInboxItem(inbox, { ...CARD, title: 'Second?' })
    await retirer.pass()
    await retirer.pass()
    expect(get).toHaveBeenCalledTimes(1)
    tick(MR_CACHE_MS)
    await retirer.pass()
    expect(get).toHaveBeenCalledTimes(2)
  })

  it("keeps a card waiting when GitLab can't say, and reports why", async () => {
    const { store, inbox, retirer } = setup(() => new Error('glab: 502'))
    addInboxItem(inbox, CARD)
    await retirer.pass()
    const item = store.inbox.get('in_0000000000000001')!
    expect(item.status).toBe('open')
    expect(retirer.blockFor(item)).toEqual({ unknown: 'MR state unknown: glab: 502' })
  })

  it('never asks about a job-wide card', async () => {
    const { inbox, retirer, get } = setup(() => 'merged')
    addInboxItem(inbox, {
      ...CARD,
      runId: undefined,
      automationId: 'ci',
      itemKey: 'repo:web-platform'
    })
    expect(await retirer.pass()).toBe(0)
    expect(get).not.toHaveBeenCalled()
  })

  it('keeps retiring the rest when a card was ticked while the pass was waiting on GitLab', async () => {
    const { store, inbox, retirer, get } = setup(() => 'merged')
    addInboxItem(inbox, CARD)
    addInboxItem(inbox, { ...CARD, title: 'Second?' })
    get.mockImplementationOnce(async () => {
      store.inbox.update('in_0000000000000001', { status: 'done', outcome: 'kept' }, 1000)
      return { iid: 1561, state: 'merged' } as never
    })
    expect(await retirer.pass()).toBe(1)
    expect(store.inbox.get('in_0000000000000001')).toMatchObject({
      status: 'done',
      outcome: 'kept'
    })
    expect(store.inbox.get('in_0000000000000002')?.status).toBe('obsolete')
  })
})

describe('retireTarget', () => {
  // A ticket run's worktree is made by the run (new_worktree), so its tick snapshot has no worktree.branch.
  it.each([
    ['an MR', { 'mr.branch': 'web-1-a' }],
    ['a worktree', { 'worktree.branch': 'web-1-a' }],
    ['a Linear ticket', { 'ticket.branch': 'web-1-a', 'worktree.branch': null }]
  ])("is the branch of %s item, from its run's tick", (_kind, fields) => {
    const { store, inbox } = setup(() => 'opened')
    const tickId = store.startTick('ci', 1)
    const decision = {
      key: 'item-1',
      label: 'item',
      verdict: 'started' as const,
      reason: '',
      checks: [],
      onceKey: 'item-1',
      fields
    }
    store.recordDecisions(tickId, [decision], new Map([['item-1', 'run-2']]))
    store.runs.create({
      id: 'run-2',
      automationId: 'ci',
      tickId,
      itemKey: 'item-1',
      itemLabel: 'item',
      worktreePath: '/wt/1',
      startedAt: 1
    })
    addInboxItem(inbox, { ...CARD, runId: 'run-2' })
    expect(retireTarget(store, store.inbox.get('in_0000000000000001')!)).toEqual({
      branch: 'web-1-a'
    })
  })
})
