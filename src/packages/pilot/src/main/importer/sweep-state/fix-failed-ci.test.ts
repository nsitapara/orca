import { describe, expect, it } from 'vitest'
import { fixFailedCiState } from './fix-failed-ci'
import { stateReader } from './test-reader'

function reader(state: Record<string, unknown>) {
  return stateReader({ json: (rel) => (Object.hasOwn(state, rel) ? state[rel] : null) })
}

describe('fixFailedCiState', () => {
  it.each<[string, Record<string, unknown>, string[], string[]]>([
    [
      'each "<iid>": <pipeline> becomes <iid>:<pipeline>',
      { 'ci-fix/handled.json': { '1587': 2933991087, '1590': 2934000001 } },
      ['1587:2933991087', '1590:2934000001'],
      []
    ],
    [
      'entries that aren\'t "<iid>": <pipeline id> are reported, not imported',
      { 'ci-fix/handled.json': { '1587': 2933991087, x: 5, '1591': null, '1592': '7' } },
      ['1587:2933991087'],
      [
        'ci-fix/handled.json: skipped 1591: null',
        'ci-fix/handled.json: skipped 1592: "7"',
        'ci-fix/handled.json: skipped x: 5'
      ]
    ],
    ['no handled.json, nothing to import', {}, [], []]
  ])('%s', (_, state, keys, notes) => {
    const plan = fixFailedCiState.plan(reader(state))
    expect(plan.handled).toEqual(keys.map((onceKey) => ({ onceKey, status: 'done' })))
    expect(plan.notes).toEqual(notes)
  })

  it("imports the sweep's tabs, Claude and Codex, as sessions in their worktrees", () => {
    const plan = fixFailedCiState.plan(
      reader({
        'ci-fix/tabs.json': { '/wt/web-2118': 'term_a' },
        'ci-fix/tabs-codex.json': { '/wt/web-1474': 'term_b' }
      })
    )
    expect(plan.sessions).toEqual([
      {
        worktreePath: '/wt/web-2118',
        terminalHandle: 'term_a',
        agent: 'claude',
        label: 'web-2118'
      },
      { worktreePath: '/wt/web-1474', terminalHandle: 'term_b', agent: 'codex', label: 'web-1474' }
    ])
  })
})
