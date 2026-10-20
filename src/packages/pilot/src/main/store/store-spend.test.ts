import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import type { SpendGroup } from '../../shared/api-types'
import type { AgentKind } from '../../shared/definition/types'
import { PilotStore } from './store'

// fix-ci: !1561 (Claude fix-gitlab-ci $1 + Codex unpriced, today) and !1574 (Claude $2, six days ago).
// e2e: WEB-2118 (Claude dev-e2e-fix $0.50, today).
function setup(): PilotStore {
  const store = PilotStore.open(join(mkdtempSync(join(tmpdir(), 'pilot-spend-')), 'db.sqlite'))
  const run = (id: string, automationId: string, itemKey: string, itemLabel: string) =>
    store.runs.create({
      id,
      automationId,
      tickId: null,
      itemKey,
      itemLabel,
      worktreePath: '/wt',
      startedAt: 1
    })
  run('r1', 'fix-ci', 'mr:1561', '!1561 web-1493')
  run('r2', 'fix-ci', 'mr:1574', '!1574 web-1474')
  run('r3', 'e2e', 'linear:WEB-2118', 'WEB-2118')
  const step = (runId: string, idx: number, agent: string, skill: string | null) =>
    store.runs.createStep({ runId, idx, name: `s${idx}`, agent, skill, startedAt: 1 })
  step('r1', 0, 'claude', 'fix-gitlab-ci')
  step('r1', 1, 'codex', null)
  step('r2', 0, 'claude', 'fix-gitlab-ci')
  step('r3', 0, 'claude', 'dev-e2e-fix')
  const save = (
    runId: string,
    idx: number,
    day: string,
    costUsd: number | null,
    input: number,
    agent: AgentKind = 'claude'
  ) =>
    store.usage.saveStepUsage(
      runId,
      idx,
      [
        {
          agent,
          day,
          model: 'm',
          requests: 1,
          input,
          cacheRead: 0,
          cacheWrite: 0,
          output: 0,
          costUsd
        }
      ],
      true,
      1
    )
  save('r1', 0, '2026-10-11', 1, 100)
  save('r1', 1, '2026-10-11', null, 50, 'codex')
  save('r2', 0, '2026-10-05', 2, 200)
  save('r3', 0, '2026-10-11', 0.5, 10)
  return store
}

const row = (r: {
  key: string
  costUsd: number | null
  tokens: number
  runs: number
  steps: number
  unpricedBuckets: number
}) => [r.key, r.costUsd, r.tokens, r.runs, r.steps, r.unpricedBuckets]

describe('SpendStore.byGroup', () => {
  it.each<[SpendGroup, string, unknown[][]]>([
    [
      'automation',
      '2026-10-01',
      [
        ['fix-ci', 3, 350, 2, 3, 1],
        ['e2e', 0.5, 10, 1, 1, 0]
      ]
    ],
    [
      'automation',
      '2026-10-10',
      [
        ['fix-ci', 1, 150, 1, 2, 1],
        ['e2e', 0.5, 10, 1, 1, 0]
      ]
    ],
    [
      'skill',
      '2026-10-01',
      [
        ['fix-gitlab-ci', 3, 300, 2, 2, 0],
        ['dev-e2e-fix', 0.5, 10, 1, 1, 0],
        ['', null, 50, 1, 1, 1]
      ]
    ],
    [
      'agent',
      '2026-10-01',
      [
        ['claude', 3.5, 310, 3, 3, 0],
        ['codex', null, 50, 1, 1, 1]
      ]
    ],
    [
      'mr',
      '2026-10-01',
      [
        ['mr:1574', 2, 200, 1, 1, 0],
        ['mr:1561', 1, 150, 1, 2, 1]
      ]
    ]
  ])('by %s since %s', (by, since, expected) => {
    expect(setup().spend.byGroup(by, since).map(row)).toEqual(expected)
  })

  it('keeps the MR label for each MR key', () => {
    expect(
      setup()
        .spend.byGroup('mr', '2026-10-01')
        .map((r) => r.itemLabel)
    ).toEqual(['!1574 web-1474', '!1561 web-1493'])
  })
})

describe('SpendStore.totals', () => {
  it('counts each run once, whatever the grouping', () => {
    expect(setup().spend.totals('2026-10-01')).toEqual({ costUsd: 3.5, tokens: 360, runs: 3 })
    expect(setup().spend.totals('2026-10-12')).toEqual({ costUsd: 0, tokens: 0, runs: 0 })
  })
})

describe('report queries', () => {
  it('lists every measured bucket of a step that had a session, with its run and step', () => {
    const store = setup()
    store.runs.updateStep('r1', 0, { sessionId: 's-r1-0' })
    expect(
      store.spend
        .reportBuckets()
        .map((b) => [b.automationId, b.sessionId, b.day, b.costUsd, b.itemLabel, b.worktreePath])
    ).toEqual([['fix-ci', 's-r1-0', '2026-10-11', 1, '!1561 web-1493', '/wt']])
  })

  it('counts agent steps still going or not measured yet as pending', () => {
    const store = setup()
    store.runs.createStep({
      runId: 'r3',
      idx: 1,
      name: 's1',
      agent: 'claude',
      skill: null,
      startedAt: 5
    })
    store.runs.updateStep('r3', 1, { status: 'running' })
    expect(store.spend.pendingAgentSteps()).toBe(1)
  })

  it('lists measured steps that had a tab but no usable session', () => {
    const store = setup()
    store.runs.createStep({
      runId: 'r3',
      idx: 1,
      name: 's1',
      agent: 'codex',
      skill: null,
      startedAt: 5
    })
    store.runs.updateStep('r3', 1, { status: 'failed', terminalHandle: 'term_9', finishedAt: 6 })
    store.usage.saveStepUsage('r3', 1, [], false, 7)
    expect(store.spend.sessionlessSteps()).toEqual([
      {
        automationId: 'e2e',
        agent: 'codex',
        startedAt: 5,
        worktreePath: '/wt',
        itemLabel: 'WEB-2118'
      }
    ])
  })
})

// usage.json's cwd is where a session ran: an env run's folder, not its home (usage.py names the worktree after the cwd).
describe('report queries for an env run', () => {
  it.each([
    [
      'its measured buckets',
      (store: PilotStore) => {
        store.runs.updateStep('r1', 0, { sessionId: 's-r1-0' })
        return store.spend.reportBuckets().map((b) => b.worktreePath)
      }
    ],
    [
      'its steps with no session',
      (store: PilotStore) => {
        store.runs.createStep({
          runId: 'r1',
          idx: 2,
          name: 's2',
          agent: 'codex',
          skill: null,
          startedAt: 5
        })
        store.runs.updateStep('r1', 2, {
          status: 'failed',
          terminalHandle: 'term_9',
          finishedAt: 6
        })
        store.usage.saveStepUsage('r1', 2, [], false, 7)
        return store.spend.sessionlessSteps().map((s) => s.worktreePath)
      }
    ]
  ])('%s say where it ran: its throwaway folder', (_name, read) => {
    const store = setup()
    store.runs.envs.begin('r1', '/wt', {})
    store.runs.envs.ready('r1', {
      mode: 'throwaway',
      reason: '',
      path: '/agents/agents-r1',
      home: '/wt',
      worktreeId: 'id',
      sha: null,
      envFile: null,
      vars: {},
      stack: null
    })
    expect(read(store)).toEqual(['/agents/agents-r1'])
  })
})

describe('SpendStore.totals by group', () => {
  it("--by mr totals only the MR runs, so the total equals the rows' sum", () => {
    const store = setup()
    expect(store.spend.totals('2026-10-01', 'mr')).toEqual({ costUsd: 3, tokens: 350, runs: 2 })
    expect(store.spend.totals('2026-10-01', 'skill')).toEqual({
      costUsd: 3.5,
      tokens: 360,
      runs: 3
    })
  })
})
