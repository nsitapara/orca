import { describe, expect, it } from 'vitest'
import { PilotStore } from '../../store/store'
import { applyImport } from './apply'
import { MAPPERS } from './registry'
import { stateReader } from './test-reader'
import { uiQaOvernightMapper } from './ui-qa-overnight'

const A = 'a'.repeat(40)
const B = 'b'.repeat(40)
const WORKTREES = [{ id: 'repo::/wt/a', path: '/wt/a', branch: 'web-1-a' }]

function reader(state: Record<string, unknown>, now = 9) {
  return stateReader({
    json: (rel) => (Object.hasOwn(state, rel) ? state[rel] : null),
    worktrees: () => WORKTREES,
    now
  })
}

describe('04 state import', () => {
  it('imports tested heads as done and failed heads with their failure time, so the 12-hour hold carries over', () => {
    const plan = uiQaOvernightMapper.plan(
      reader({
        'ui-qa/seen.json': { '/wt/a': A },
        'ui-qa/failed.json': { '/wt/a': { head: B, at: 1_760_000_000.5, outcome: 'stack_failed' } }
      })
    )
    expect(plan.handled).toEqual([
      { onceKey: `repo::/wt/a@${A}`, status: 'done', at: 9, failedAt: null },
      {
        onceKey: `repo::/wt/a@${B}`,
        status: 'failed',
        at: 1_760_000_000_500,
        failedAt: 1_760_000_000_500
      }
    ])
    expect(plan.seen).toEqual([{ itemKey: 'wt:repo::/wt/a', at: 9 }])
    expect(plan.notes).toEqual([])
  })

  // The marker is where the last test ended; a failed head only waits. Imported rows have no run, so the marker
  // store must not read a failed one as progress: a first sight that failed (no tested head) stays a first sight.
  it.each([
    ['a tested head and a later failure', { '/wt/a': A }, new Map([['repo::/wt/a', A]])],
    ['a first sight that failed', {}, new Map()]
  ])(
    "keeps the marker at the tested head with %s; the failed head's hold runs from the old failure",
    (_name, seen, markers) => {
      const store = PilotStore.open(':memory:')
      try {
        const failedAt = 1_760_000_000
        const now = failedAt * 1000 + 60_000
        const state = {
          'ui-qa/seen.json': seen,
          'ui-qa/failed.json': { '/wt/a': { head: B, at: failedAt, outcome: 'stopped' } }
        }
        applyImport(store, uiQaOvernightMapper.plan(reader(state, now)), now)
        expect(store.markers.progressMarkers('ui-qa-overnight')).toEqual(markers)
        expect(
          store.handledRows('ui-qa-overnight').find((r) => r.onceKey.endsWith(B))
        ).toMatchObject({
          status: 'failed',
          failedAt: failedAt * 1000
        })
      } finally {
        store.close()
      }
    }
  )

  it.each([
    [
      'an open run',
      { 'ui-qa/run.json': { status: 'running', branch: 'web-1-a' } },
      "run.json: a QA run on web-1-a is still open; close it out with the old app's `loop.py sweep` before go-live"
    ],
    [
      'a fix still marked dispatched',
      { 'ui-qa/fixes.json': { '/r/x': { status: 'dispatched', branch: 'web-1-a' } } },
      "fixes.json: the automatic fix for web-1-a is still dispatched; Pilot doesn't track it"
    ],
    [
      'a worktree Orca no longer lists',
      { 'ui-qa/seen.json': { '/wt/gone': A } },
      "no Orca worktree at /wt/gone; its QA state isn't imported"
    ],
    [
      'a tested value that is not a sha',
      { 'ui-qa/seen.json': { '/wt/a': 'HEAD' } },
      '/wt/a: "HEAD" isn\'t a commit sha; skipped'
    ],
    [
      'a failed entry without a head sha and a time',
      { 'ui-qa/failed.json': { '/wt/a': { head: 'HEAD', outcome: 'stopped' } } },
      "/wt/a: failed.json's entry has no head sha and time; skipped"
    ],
    [
      'a file that is not an object',
      { 'ui-qa/failed.json': ['/wt/a'] },
      'ui-qa/failed.json: expected a JSON object'
    ]
  ])('reports %s', (_name, state, note) => {
    const plan = uiQaOvernightMapper.plan(reader(state))
    expect(plan.handled).toEqual([])
    expect(plan.notes).toEqual([note])
  })

  it('leaves a closed run and finished fixes unreported', () => {
    const plan = uiQaOvernightMapper.plan(
      reader({
        'ui-qa/run.json': { status: 'done', branch: 'web-1-a' },
        'ui-qa/fixes.json': { '/r/x': { status: 'done' }, '/r/y': { status: 'blocked' } }
      })
    )
    expect(plan.notes).toEqual([])
  })

  it('is registered', () => {
    expect(MAPPERS).toContain(uiQaOvernightMapper)
  })
})
