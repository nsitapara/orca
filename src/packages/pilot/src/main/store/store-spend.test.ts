import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import type { SpendGroup } from '../../shared/api-types'
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
  const save = (runId: string, idx: number, day: string, costUsd: number | null, input: number) =>
    store.usage.saveStepUsage(
      runId,
      idx,
      [{ day, model: 'm', requests: 1, input, cacheRead: 0, cacheWrite: 0, output: 0, costUsd }],
      true,
      1
    )
  save('r1', 0, '2026-10-11', 1, 100)
  save('r1', 1, '2026-10-11', null, 50)
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
