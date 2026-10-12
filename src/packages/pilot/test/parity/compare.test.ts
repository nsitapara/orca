import { describe, expect, it } from 'vitest'
import type { ItemDecision, Verdict } from '../../src/shared/api-types'
import { compareDecisions, formatMismatches, type VerdictTable } from './compare'
import type { OldDecision } from './old-side'

const old = (key: string, decision: string, reason = ''): OldDecision => ({
  key,
  label: key,
  decision,
  reason
})
const fresh = (key: string, verdict: Verdict, reason = ''): ItemDecision => ({
  key,
  label: key,
  verdict,
  reason,
  checks: [],
  onceKey: key,
  fields: {}
})
const TABLE: VerdictTable = {
  map: { due: ['started'], skip: ['skipped'], absent: ['notdue'] },
  whenOldMissing: ['out_of_scope']
}
// Reason-sensitive words and named differences (R-n).
const RICH: VerdictTable = {
  map: { due: ['started'], skip: ['notdue'], absent: ['notdue'] },
  whenOldMissing: ['out_of_scope'],
  rows: [{ word: 'skip', reason: /uncommitted/, verdicts: ['skipped'] }],
  known: [
    { key: 'mr:3', word: 'due', verdict: 'over_limit', why: 'Pilot counts the limit per tick' },
    { key: 'mr:4', word: 'skip', verdict: 'absent', why: 'Pilot drops items with no worktree' },
    {
      key: 'mr:5',
      word: '(not listed)',
      verdict: 'started',
      why: 'Pilot lists drafts the sweep ignored'
    }
  ]
}

describe('compareDecisions', () => {
  it.each([
    ['agreeing decisions', [old('mr:1', 'due')], [fresh('mr:1', 'started')], []],
    [
      'a different verdict',
      [old('mr:1', 'due')],
      [fresh('mr:1', 'skipped', '1 uncommitted file')],
      [{ key: 'mr:1', old: 'due', fresh: 'skipped: 1 uncommitted file' }]
    ],
    [
      'an old word with no mapping',
      [old('mr:1', 'defer', '--max 3 reached')],
      [fresh('mr:1', 'over_limit')],
      [{ key: 'mr:1', old: 'defer: --max 3 reached', fresh: 'over_limit' }]
    ],
    [
      'an item only the new side lists, allowed',
      [],
      [fresh('mr:9', 'out_of_scope', 'Author is Emil')],
      []
    ],
    [
      'an item only the new side lists, not allowed',
      [],
      [fresh('mr:9', 'started')],
      [{ key: 'mr:9', old: '(not listed)', fresh: 'started' }]
    ],
    [
      'an item the new side misses',
      [old('mr:2', 'skip', 'no Orca worktree')],
      [],
      [{ key: 'mr:2', old: 'skip: no Orca worktree', fresh: '(not listed)' }]
    ]
  ] as [string, OldDecision[], ItemDecision[], unknown][])('%s', (_n, o, f, expected) => {
    expect(compareDecisions(o, f, TABLE)).toEqual(expected)
  })

  it.each([
    [
      'a row whose reason matches wins over the word map',
      [old('mr:1', 'skip', 'uncommitted changes; retry next round')],
      [fresh('mr:1', 'skipped')],
      []
    ],
    [
      'a row whose reason does not match falls back to the map',
      [old('mr:2', 'skip', 'no Orca worktree')],
      [fresh('mr:2', 'skipped')],
      [{ key: 'mr:2', old: 'skip: no Orca worktree', fresh: 'skipped' }]
    ],
    [
      'a known difference is not a mismatch',
      [old('mr:3', 'due')],
      [fresh('mr:3', 'over_limit')],
      []
    ],
    [
      'a known difference covers only its own verdict',
      [old('mr:3', 'due')],
      [fresh('mr:3', 'skipped')],
      [{ key: 'mr:3', old: 'due', fresh: 'skipped' }]
    ],
    [
      'a known difference where the new side lists nothing',
      [old('mr:4', 'skip', 'no Orca worktree')],
      [],
      []
    ],
    ['a known difference for an item only the new side lists', [], [fresh('mr:5', 'started')], []]
  ] as [string, OldDecision[], ItemDecision[], unknown][])('%s', (_n, o, f, expected) => {
    expect(compareDecisions(o, f, RICH)).toEqual(expected)
  })

  it('formats one mismatch per line', () => {
    expect(
      formatMismatches([
        { key: 'mr:1', old: 'due', fresh: 'skipped: dirty' },
        { key: 'mr:2', old: 'skip', fresh: '(not listed)' }
      ])
    ).toBe('mr:1: old due | new skipped: dirty\nmr:2: old skip | new (not listed)')
  })
})
