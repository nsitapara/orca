import { describe, expect, it } from 'vitest'
import type { ItemDecision } from '../../shared/api-types'
import { parseAutomationYaml } from '../../shared/definition/parse'
import { PilotStore } from '../store/store'
import { createRunEngine, type StepStartRequest } from './advance'

const DECISION: ItemDecision = {
  key: 'mr:1',
  label: '!1 web-1',
  verdict: 'started',
  reason: '',
  checks: [],
  onceKey: '1:9',
  fields: { 'mr.iid': 1, 'worktree.path': '/wt', 'worktree.id': 'wt-1' }
}

function definition(steps: string) {
  const yaml = `name: Kick\nrepo: web-platform\nschedule: manual\nitems: { kind: merge_request }\nsteps:\n${steps}`
  const parsed = parseAutomationYaml(yaml, '/a/kick.yaml')
  if (!parsed.ok) {
    throw new Error(parsed.errors.join('\n'))
  }
  return parsed.definition
}

// A launcher stand-in: a step on another system ends done, detached, at its launch; a Pilot step runs in a tab; the
// steps named in `failing` can't start.
function setup(steps: string, failing: number[] = []) {
  const def = definition(steps)
  const store = PilotStore.open(':memory:')
  const started: number[] = []
  const engine = createRunEngine({
    store,
    now: () => 1000,
    definitionFor: (id) => (id === def.id ? def : null),
    startStep: async (req: StepStartRequest) => {
      started.push(req.idx)
      if (failing.includes(req.idx)) {
        throw new Error('refused')
      }
      const s = req.definition.steps[req.idx]
      if (!store.runs.steps(req.run.id).some((r) => r.idx === req.idx)) {
        store.runs.createStep({
          runId: req.run.id,
          idx: req.idx,
          name: s.name,
          agent: s.agent,
          skill: s.skill,
          startedAt: 1000
        })
      }
      const patch = s.system
        ? {
            status: 'done' as const,
            finishedAt: 1000,
            detached: true,
            system: 'herdr' as const,
            externalRef: 'w1:t2'
          }
        : { status: 'running' as const, terminalHandle: 't', paneKey: 'p' }
      store.runs.updateStep(req.run.id, req.idx, patch)
    },
    workspace: {
      listWorktrees: async () => [],
      createWorktree: async () => {
        throw new Error('not expected')
      },
      claimWorktree: () => {
        throw new Error('not expected')
      }
    },
    log: () => {},
    closeTerminal: async () => {},
    relist: async () => false
  })
  store.runs.create({
    id: 'run-1',
    automationId: def.id,
    tickId: null,
    itemKey: 'mr:1',
    itemLabel: '!1 web-1',
    worktreePath: '/wt',
    startedAt: 500
  })
  store.markHandled(def.id, '1:9', 'run-1', 500)
  const startRun = () => engine.startRun({ runId: 'run-1', definition: def, decision: DECISION })
  const handled = () => store.handledRows(def.id).map((r) => r.status)
  return { store, engine, started, startRun, handled }
}

const KICKOFF = '  - { name: kickoff, agent: claude, prompt: Go, wait: start, system: herdr }\n'

describe('a run whose step is handed over on another system', () => {
  it('goes on to the next step in the same walk', async () => {
    const { store, engine, started, startRun } = setup(
      `${KICKOFF}  - { name: fix, agent: claude, prompt: Fix }\n`
    )
    await startRun()
    expect(started).toEqual([0, 1])
    store.runs.updateStep('run-1', 1, { status: 'done', finishedAt: 1000 })
    await engine.advance('run-1')
    expect(store.runs.get('run-1')?.status).toBe('done')
  })

  it.each([
    ['a lone hand-over step ends the run done', '', [], 'done'],
    [
      'a later step that cannot start fails the run through its end, never the tick runner',
      '  - { name: next, agent: claude, prompt: Next }\n',
      [1],
      'failed'
    ]
  ])('%s', async (_, more, failing, status) => {
    const { store, startRun, handled } = setup(KICKOFF + more, failing)
    await expect(startRun()).resolves.toBeUndefined()
    expect(store.runs.get('run-1')?.status).toBe(status)
    expect(handled()).toEqual([status])
  })
})
