import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import type { AgentKind } from '../../shared/definition/types'
import { PilotStore } from '../store/store'
import { usageDashboard } from './usage-dashboard'

const NOW = new Date(2026, 9, 20, 15).getTime()
const NAMES = new Map([
  ['ui-qa', '04 · Test branch UIs overnight'],
  ['review', '03 · Review and fix branch code']
])

// Today: ui-qa r1 (Codex 900 tokens $9, then a Claude fix 100 tokens $1), review r2 (a Claude orchestrator $2 whose
// Codex check is $0.50). Two days ago: merge-dev r3 (Codex $4, no name loaded) and r4 (an unpriced model).
function setup(): PilotStore {
  const store = PilotStore.open(join(mkdtempSync(join(tmpdir(), 'pilot-usage-dash-')), 'db.sqlite'))
  const run = (id: string, automationId: string, startedAt: number) =>
    store.runs.create({
      id,
      automationId,
      tickId: null,
      itemKey: id,
      itemLabel: `${id} item`,
      worktreePath: '/wt',
      startedAt
    })
  type Bucket = [day: string, agent: AgentKind, tokens: number, costUsd: number | null]
  const step = (runId: string, idx: number, agent: AgentKind, buckets: Bucket[]) => {
    store.runs.createStep({ runId, idx, name: `s${idx}`, agent, skill: null, startedAt: 1 })
    store.usage.saveStepUsage(
      runId,
      idx,
      buckets.map(([day, bucketAgent, input, costUsd]) => ({
        agent: bucketAgent,
        day,
        model: `${bucketAgent}-model`,
        requests: 1,
        input,
        cacheRead: 0,
        cacheWrite: 0,
        output: 0,
        costUsd
      })),
      true,
      1
    )
  }
  run('r1', 'ui-qa', 10)
  step('r1', 0, 'codex', [['2026-10-20', 'codex', 900, 9]])
  step('r1', 1, 'claude', [['2026-10-20', 'claude', 100, 1]])
  run('r2', 'review', 20)
  step('r2', 0, 'claude', [
    ['2026-10-20', 'claude', 200, 2],
    ['2026-10-20', 'codex', 50, 0.5]
  ])
  run('r3', 'merge-dev', 5)
  step('r3', 0, 'codex', [['2026-10-18', 'codex', 400, 4]])
  run('r4', 'merge-dev', 6)
  step('r4', 0, 'codex', [['2026-10-18', 'codex', 7, null]])
  return store
}

describe('usageDashboard', () => {
  it("splits today's spend by automation and agent, most expensive first", () => {
    const dash = usageDashboard(setup(), NAMES, { days: 1 }, NOW)
    expect(dash.sinceDay).toBe('2026-10-20')
    expect(dash.total).toEqual({
      runs: 2,
      tokens: 1250,
      costUsd: 12.5,
      byAgent: { claude: { tokens: 300, costUsd: 3 }, codex: { tokens: 950, costUsd: 9.5 } }
    })
    expect(dash.automations).toEqual([
      {
        automationId: 'ui-qa',
        name: '04 · Test branch UIs overnight',
        runs: 1,
        tokens: 1000,
        costUsd: 10,
        byAgent: { claude: { tokens: 100, costUsd: 1 }, codex: { tokens: 900, costUsd: 9 } }
      },
      {
        automationId: 'review',
        name: '03 · Review and fix branch code',
        runs: 1,
        tokens: 250,
        costUsd: 2.5,
        byAgent: { claude: { tokens: 200, costUsd: 2 }, codex: { tokens: 50, costUsd: 0.5 } }
      }
    ])
    expect(dash.topRuns.map((r) => [r.runId, r.costUsd])).toEqual([
      ['r1', 10],
      ['r2', 2.5]
    ])
  })

  it('fills every day of the period, and an unpriced model adds tokens but no cost', () => {
    const dash = usageDashboard(setup(), NAMES, { days: 3 }, NOW)
    expect(dash.daily.map((d) => [d.day, d.byAgent.codex.tokens, d.byAgent.codex.costUsd])).toEqual(
      [
        ['2026-10-18', 407, 4],
        ['2026-10-19', 0, null],
        ['2026-10-20', 950, 9.5]
      ]
    )
    expect(dash.automations.find((a) => a.automationId === 'merge-dev')).toMatchObject({
      name: 'merge-dev',
      runs: 2,
      tokens: 407,
      costUsd: 4
    })
  })

  it("ranks each agent's spend since its weekly reset, even from before the period", () => {
    const dash = usageDashboard(
      setup(),
      NAMES,
      { days: 1, resetDays: { codex: '2026-10-18', claude: '2026-10-20' } },
      NOW
    )
    expect(dash.sinceReset.codex).toEqual({
      sinceDay: '2026-10-18',
      total: { tokens: 1357, costUsd: 13.5 },
      automations: [
        { automationId: 'ui-qa', name: '04 · Test branch UIs overnight', tokens: 900, costUsd: 9 },
        { automationId: 'merge-dev', name: 'merge-dev', tokens: 407, costUsd: 4 },
        {
          automationId: 'review',
          name: '03 · Review and fix branch code',
          tokens: 50,
          costUsd: 0.5
        }
      ]
    })
    expect(dash.sinceReset.claude?.automations.map((a) => a.automationId)).toEqual([
      'review',
      'ui-qa'
    ])
  })
})
