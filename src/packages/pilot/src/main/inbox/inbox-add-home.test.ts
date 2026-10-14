import { describe, expect, it } from 'vitest'
import { parseAutomationYaml } from '../../shared/definition/parse'
import { parsePeopleYaml } from '../../shared/people'
import { PilotStore } from '../store/store'
import type { EnvReady } from '../store/store-envs'
import { addInboxItem } from './inbox-add'
import type { InboxDeps } from './inbox-service'

const def = parseAutomationYaml(
  'name: Fix CI\nrepo: r\nschedule: manual\nitems: { kind: merge_request }\nsteps: [ { agent: claude, prompt: x } ]\ninbox: nish\n',
  '/a/ci.yaml'
)
const people = parsePeopleYaml('people:\n  - { id: nish, name: Nish }\n')
if (!def.ok || !people.ok) {
  throw new Error('setup')
}

const READY: EnvReady = {
  mode: 'throwaway',
  reason: 'uncommitted changes',
  path: '/agents/r/agents-r1',
  home: '/wt/a',
  worktreeId: 'repo::/agents/r/agents-r1',
  sha: 'abc',
  envFile: '/state/envs/r1/env.sh',
  vars: {},
  stack: null
}

describe('addInboxItem for an env run', () => {
  it('puts the card on the item worktree (home), not the env folder the run works in', () => {
    const store = PilotStore.open(':memory:')
    const deps: InboxDeps = {
      store,
      now: () => 1_000,
      definitions: () => [def.ok ? def.definition : (null as never)],
      people: () => (people.ok ? people.directory : (null as never)),
      newId: () => 'in_0000000000000001'
    }
    store.runs.create({
      id: 'r1',
      automationId: 'ci',
      tickId: null,
      itemKey: 'mr:1',
      itemLabel: '!1',
      worktreePath: '/wt/a',
      startedAt: 1
    })
    store.runs.envs.begin('r1', '/wt/a', {})
    expect(store.runs.envs.ready('r1', READY)).toBe(true)
    addInboxItem(deps, { runId: 'r1', type: 'question', title: 'Push?' })
    expect(store.inbox.get('in_0000000000000001')?.worktreePath).toBe('/wt/a')
  })
})
