import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import Database from '../../../../../main/sqlite/sync-database'
import type { ItemDecision } from '../../shared/api-types'
import type { AutomationDefinition } from '../../shared/definition/types'
import { PilotStore } from '../store/store'
import { buildWorktreeTimeline, startOfDay } from './worktree-timeline'

const NOON = new Date(2026, 9, 11, 12, 0).getTime()
const YESTERDAY = new Date(2026, 9, 10, 15, 0).getTime()

function setup() {
  const file = join(mkdtempSync(join(tmpdir(), 'pilot-wt-timeline-')), 'db.sqlite')
  const store = PilotStore.open(file)
  const run = (id: string, automationId: string, path: string, startedAt: number) =>
    store.runs.create({
      id,
      automationId,
      tickId: null,
      itemKey: 'mr:1',
      itemLabel: '!1 web-1',
      worktreePath: path,
      startedAt
    })
  run('r-now', 'fix-ci', '/wt/a', NOON - 60_000)
  run('r-done', 'review', '/wt/a', NOON - 3_600_000)
  store.runs.update('r-done', { status: 'done', finishedAt: NOON - 3_000_000, outcome: 'Done' })
  run('r-old', 'fix-ci', '/wt/a', YESTERDAY)
  store.runs.update('r-old', { status: 'done', finishedAt: YESTERDAY + 1 })
  run('r-old-running', 'fix-ci', '/wt/a', YESTERDAY)
  run('r-other', 'fix-ci', '/wt/b', NOON - 1_000)
  store.runs.createStep({
    runId: 'r-done',
    idx: 0,
    name: 'review',
    agent: 'claude',
    skill: null,
    startedAt: NOON - 3_600_000
  })
  store.usage.saveStepUsage(
    'r-done',
    0,
    [
      {
        agent: 'claude',
        day: '2026-10-11',
        model: 'm',
        requests: 1,
        input: 1,
        cacheRead: 0,
        cacheWrite: 0,
        output: 0,
        costUsd: 0.84
      }
    ],
    true,
    NOON
  )
  const raw = new Database(file)
  const insert = raw.prepare(
    `INSERT INTO inbox_items (id, automation_id, run_id, worktree_path, person, type, title, digest, status, created_at, updated_at)
     VALUES (?, 'review', ?, ?, ?, 'question', ?, 'd', ?, ?, 1)`
  )
  insert.run('i1', 'r-done', '/wt/a', 'nish', 'Post the review?', 'open', 1)
  insert.run('i2', null, '/wt/a', 'shivan', 'Which base?', 'open', 2)
  insert.run('i3', 'r-done', '/wt/a', 'nish', 'Old one', 'answered', 3)
  insert.run('i4', 'r-done', '/wt/a', 'shivan', 'Not yours', 'open', 4)
  const t = store.startTick('fix-ci', NOON - 600_000)
  store.recordDecisions(
    t,
    [
      {
        key: 'mr:1',
        label: '!1 web-1',
        verdict: 'skipped',
        reason: '2 uncommitted files',
        checks: [],
        onceKey: 'k',
        fields: { 'worktree.path': '/wt/a' }
      } as ItemDecision
    ],
    new Map()
  )
  store.finishTick(t, 'ok', null, {}, NOON - 590_000)
  const defs = [
    { id: 'fix-ci', name: 'Fix failed CI on my MRs' },
    { id: 'review', name: 'Prepare reviews' }
  ] as AutomationDefinition[]
  return {
    store,
    deps: {
      store,
      definitions: () => defs,
      nextTickAt: (d: AutomationDefinition) => (d.id === 'fix-ci' ? NOON + 600_000 : null),
      now: () => NOON
    }
  }
}

describe('buildWorktreeTimeline', () => {
  it('puts running runs (even from yesterday) under now, and the rest of today under earlier', () => {
    const t = buildWorktreeTimeline(setup().deps, '/wt/a', null)
    expect(t.now.map((r) => r.id)).toEqual(['r-now', 'r-old-running'])
    expect(t.earlier.map((r) => r.id)).toEqual(['r-done'])
    expect(t.earlier[0]).toMatchObject({ automationName: 'Prepare reviews', outcome: 'Done' })
    expect(t.earlier[0].steps.map((s) => s.name)).toEqual(['review'])
    expect(t.earlier[0].inbox.map((i) => i.id)).toEqual(['i1', 'i3', 'i4'])
  })

  it("lists the worktree's waiting items: everyone's by default, only the person's when asked", () => {
    const { deps } = setup()
    expect(buildWorktreeTimeline(deps, '/wt/a', null).waiting.map((i) => i.id)).toEqual([
      'i1',
      'i2',
      'i4'
    ])
    const mine = buildWorktreeTimeline(deps, '/wt/a', 'nish')
    expect(mine.waiting.map((i) => i.id)).toEqual(['i1'])
    expect(mine.earlier[0].inbox.map((i) => i.id)).toEqual(['i1', 'i3'])
  })

  it("forecasts next from the last real tick, with the automation's next tick, and totals today's spend", () => {
    const t = buildWorktreeTimeline(setup().deps, '/wt/a', null)
    expect(t.next).toEqual([
      expect.objectContaining({
        automationId: 'fix-ci',
        automationName: 'Fix failed CI on my MRs',
        verdict: 'skipped',
        reason: '2 uncommitted files',
        nextTickAt: NOON + 600_000
      })
    ])
    expect(t.spentTodayUsd).toBe(0.84)
  })

  it('finds the forecast for a path spelled with a trailing slash', () => {
    expect(buildWorktreeTimeline(setup().deps, '/wt/a/', null).next.map((n) => n.itemKey)).toEqual([
      'mr:1'
    ])
  })

  it.each(['/wt/a/', '/wt/./a', '/wt//a/'])(
    'finds the runs, cards and spend of a worktree asked for as %s',
    (spelled) => {
      const { deps } = setup()
      const t = buildWorktreeTimeline(deps, spelled, null)
      expect(t.now.map((r) => r.id)).toEqual(['r-now', 'r-old-running'])
      expect(t.earlier.map((r) => r.id)).toEqual(['r-done'])
      expect(t.waiting.map((i) => i.id)).toEqual(['i1', 'i2', 'i4'])
      expect(t.spentTodayUsd).toBe(0.84)
    }
  )

  it('finds a run, card and spend stored under the slash-spelled path too', () => {
    const { store, deps } = setup()
    store.runs.create({
      id: 'r-slash',
      automationId: 'fix-ci',
      tickId: null,
      itemKey: 'mr:9',
      itemLabel: '!9',
      worktreePath: '/wt/a/',
      startedAt: NOON - 5_000
    })
    store.runs.createStep({
      runId: 'r-slash',
      idx: 0,
      name: 's',
      agent: 'claude',
      skill: null,
      startedAt: NOON
    })
    store.usage.saveStepUsage(
      'r-slash',
      0,
      [
        {
          agent: 'claude',
          day: '2026-10-11',
          model: 'm',
          requests: 1,
          input: 1,
          cacheRead: 0,
          cacheWrite: 0,
          output: 0,
          costUsd: 0.16
        }
      ],
      true,
      NOON
    )
    const t = buildWorktreeTimeline(deps, '/wt/a', null)
    expect(t.now.map((r) => r.id)).toContain('r-slash')
    expect(t.spentTodayUsd).toBeCloseTo(1, 5)
  })

  it('counts the buckets of today it could not price', () => {
    const { store, deps } = setup()
    store.runs.createStep({
      runId: 'r-now',
      idx: 0,
      name: 's',
      agent: 'claude',
      skill: null,
      startedAt: NOON
    })
    store.usage.saveStepUsage(
      'r-now',
      0,
      [
        {
          agent: 'claude',
          day: '2026-10-11',
          model: 'mystery',
          requests: 1,
          input: 1,
          cacheRead: 0,
          cacheWrite: 0,
          output: 0,
          costUsd: null
        }
      ],
      true,
      NOON
    )
    const t = buildWorktreeTimeline(deps, '/wt/a', null)
    expect(t).toMatchObject({ spentTodayUsd: 0.84, unpricedBuckets: 1 })
  })

  it('an unknown worktree is empty', () => {
    expect(buildWorktreeTimeline(setup().deps, '/wt/none', null)).toEqual({
      next: [],
      now: [],
      earlier: [],
      waiting: [],
      spentTodayUsd: 0,
      unpricedBuckets: 0
    })
  })

  it('startOfDay is local midnight', () => {
    expect(startOfDay(NOON)).toBe(new Date(2026, 9, 11).getTime())
  })
})
