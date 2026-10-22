import { describe, expect, it } from 'vitest'
import { parseAutomationYaml } from '../../shared/definition/parse'
import { parsePeopleYaml } from '../../shared/people'
import type { InboxDeps } from '../inbox/inbox-service'
import { PilotStore } from '../store/store'
import { closeStrandedCard, raiseStrandedCard } from './stranded-card'

const def = parseAutomationYaml(
  'name: 03 · Review and fix branch code\nrepo: r\nschedule: manual\nitems: { kind: merge_request }\n' +
    'steps: [ { agent: claude, prompt: x } ]\ninbox: nish\n',
  '/a/review.yaml'
)
const people = parsePeopleYaml('people:\n  - { id: nish, name: Nish }\n')
if (!def.ok || !people.ok) {
  throw new Error('setup')
}
const DEFINITION = def.definition
const DIRECTORY = people.directory
const WORK = { commits: ['a46c16a5a5ec89a766df771a1e91b9d62101073a'], edits: 0 }
const WHY = "couldn't keep its uncommitted edits: git add failed (exit 1)"

// r1 ended done in a throwaway whose delete keeps failing.
function setup() {
  const store = PilotStore.open(':memory:')
  let n = 0
  const deps: InboxDeps = {
    store,
    now: () => 1_000,
    definitions: () => [DEFINITION],
    people: () => DIRECTORY,
    newId: () => `in_000000000000000${(n += 1)}`
  }
  store.runs.create({
    id: 'r1',
    automationId: 'review',
    tickId: null,
    itemKey: 'wt:web-2219',
    itemLabel: 'web-2219',
    worktreePath: '/agents/agents-r1',
    startedAt: 1
  })
  store.runs.envs.begin('r1', '/wt/web-2219', {})
  store.runs.envs.ready('r1', {
    mode: 'throwaway',
    reason: 'needs its own stack',
    path: '/agents/agents-r1',
    home: '/wt/web-2219',
    worktreeId: 'id',
    sha: null,
    envFile: null,
    vars: {},
    stack: null
  })
  store.runs.update('r1', { status: 'done', finishedAt: 4, outcome: 'Done' })
  const run = () => store.runs.get('r1')!
  return { store, deps, run }
}

describe('the stuck-throwaway card', () => {
  it('is flagged on its run, which reads Needs you until the card closes and done after', () => {
    const t = setup()
    const id = raiseStrandedCard(t.deps, DEFINITION, t.run(), WORK, WHY)
    const card = id ? t.store.inbox.get(id) : null
    expect(card).toMatchObject({
      type: 'flagged',
      status: 'open',
      runId: 'r1',
      worktreePath: '/wt/web-2219',
      title: "⚠ A fix is stuck in a throwaway Pilot can't remove: web-2219"
    })
    expect(card?.context).toContain('left commit a46c16a5a5 in /agents/agents-r1')
    expect(card?.context).toContain(WHY)
    expect(t.run().status).toBe('needs_you')
    closeStrandedCard(
      t.deps,
      id!,
      'Removed its throwaway; its work is kept on pilot/r1 for job 15 to merge home'
    )
    expect(t.store.inbox.get(id!)?.status).toBe('done')
    expect(t.run()).toMatchObject({ status: 'done', outcome: 'Done' })
  })

  it('is the same card on every retry, and a card closed by hand stays closed', () => {
    const t = setup()
    const first = raiseStrandedCard(t.deps, DEFINITION, t.run(), WORK, WHY)
    expect(raiseStrandedCard(t.deps, DEFINITION, t.run(), WORK, WHY)).toBe(first)
    expect(t.store.inbox.get(first!)?.version).toBe(1)
    t.store.inbox.update(first!, { status: 'dismissed' }, 2_000)
    expect(() => closeStrandedCard(t.deps, first!, 'Removed')).not.toThrow()
    expect(t.store.inbox.get(first!)?.status).toBe('dismissed')
  })
})
