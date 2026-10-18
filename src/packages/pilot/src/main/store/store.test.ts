import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import Database from '../../../../../main/sqlite/sync-database'
import type { ItemDecision } from '../../shared/api-types'
import { PILOT_SCHEMA_VERSION } from './migrations'
import { INTERRUPTED, PilotStore, STUCK_TICK_MS, TICK_RETENTION_MS } from './store'

function freshStore(): PilotStore {
  return PilotStore.open(join(mkdtempSync(join(tmpdir(), 'pilot-store-')), 'pilot-automations.db'))
}

const decision = (key: string, verdict: ItemDecision['verdict']): ItemDecision => ({
  key,
  label: `${key} label`,
  verdict,
  reason: 'r',
  checks: [{ check: 'Clean', ok: true, reason: 'No uncommitted changes' }],
  onceKey: `${key}:1`,
  fields: { 'mr.iid': 1 }
})

describe('PilotStore', () => {
  it('creates the current schema and reopens without migrating twice', () => {
    const dir = mkdtempSync(join(tmpdir(), 'pilot-store-'))
    const path = join(dir, 'pilot-automations.db')
    PilotStore.open(path).close()
    const again = PilotStore.open(path)
    expect(again.schemaVersion()).toBe(PILOT_SCHEMA_VERSION)
    again.close()
  })

  // RED before the fix: the open waited the fixed 5s, then threw a bare "database is locked".
  it('fails loudly within its busy timeout, naming the file, while another connection holds it locked', () => {
    const path = join(mkdtempSync(join(tmpdir(), 'pilot-store-')), 'pilot-automations.db')
    const holder = new Database(path)
    holder.exec('BEGIN EXCLUSIVE')
    const started = Date.now()
    let error: unknown = null
    try {
      PilotStore.open(path, { busyTimeoutMs: 300 }).close()
    } catch (thrown) {
      error = thrown
    } finally {
      holder.exec('ROLLBACK')
      holder.close()
    }
    const waited = Date.now() - started
    expect(String(error)).toContain(`${path} stayed locked for 0.3s`)
    expect(waited).toBeGreaterThanOrEqual(250)
    expect(waited).toBeLessThan(3000)
  })

  it("settles a run's key as done or failed, and marking it again starts it over", () => {
    const store = freshStore()
    store.markHandled('a', 'k:1', 'run-1', 1)
    store.markHandled('a', 'k:2', 'run-2', 1)
    expect(store.setHandledStatus('a', 'run-1', 'failed', 50)).toBe(1)
    expect(store.setHandledStatus('a', 'run-2', 'done', 60)).toBe(0)
    const settled = { lastOutcome: null }
    expect(store.handledRows('a')).toEqual([
      {
        onceKey: 'k:1',
        runId: 'run-1',
        at: 1,
        status: 'failed',
        failedAt: 50,
        failures: 1,
        ...settled
      },
      {
        onceKey: 'k:2',
        runId: 'run-2',
        at: 1,
        status: 'done',
        failedAt: null,
        failures: 0,
        ...settled
      }
    ])
    // A new run on a failed key starts it over and keeps its count, so the retry limit holds.
    store.markHandled('a', 'k:1', 'run-3', 70)
    expect(store.handledRows('a')[0]).toEqual({
      onceKey: 'k:1',
      runId: 'run-3',
      at: 70,
      status: 'started',
      failedAt: null,
      failures: 1,
      lastOutcome: null
    })
    expect(store.setHandledStatus('a', 'run-3', 'failed', 80)).toBe(2)
    store.markHandled('a', 'k:1', 'run-4', 90)
    expect(store.setHandledStatus('a', 'run-4', 'done', 100)).toBe(0)
    expect(store.handledRows('a')[0]).toMatchObject({ status: 'done', failures: 0 })
    expect(store.setHandledStatus('a', 'no-such-run', 'failed', 110)).toBe(0)
    expect(store.handledRows('b')).toEqual([])
  })

  it("reads a key's last outcome from its run", () => {
    const store = freshStore()
    store.runs.create({
      id: 'run-1',
      automationId: 'a',
      tickId: null,
      itemKey: 'mr:1',
      itemLabel: '!1',
      worktreePath: null,
      startedAt: 1
    })
    store.runs.update('run-1', { status: 'failed', outcome: 'agent exited', finishedAt: 2 })
    store.markHandled('a', '1', 'run-1', 1)
    store.markHandled('a', 'seeded', null, 1)
    expect(store.handledRows('a').map((r) => [r.onceKey, r.lastOutcome])).toEqual([
      ['1', 'agent exited'],
      ['seeded', null]
    ])
  })

  it('frees a failed key on Retry, leaving a key a run still holds', () => {
    const store = freshStore()
    store.markHandled('a', 'failed', 'run-1', 1)
    store.markHandled('a', 'running', 'run-2', 1)
    store.setHandledStatus('a', 'run-1', 'failed', 2)
    store.resetFailures('a', 'failed')
    store.resetFailures('a', 'running')
    expect(store.handledKeys('a')).toEqual(new Set(['running']))
  })

  it('lists the keys that failed past the retry limit since a time, across automations', () => {
    const store = freshStore()
    const fail = (automationId: string, key: string, times: number, at: number) => {
      for (let n = 1; n <= times; n += 1) {
        const runId = `${automationId}-${key}-${n}`
        store.runs.create({
          id: runId,
          automationId,
          tickId: null,
          itemKey: `mr:${key}`,
          itemLabel: `!${key}`,
          worktreePath: null,
          startedAt: at
        })
        store.runs.update(runId, { status: 'failed', outcome: `failure ${n}`, finishedAt: at })
        store.markHandled(automationId, key, runId, at)
        store.setHandledStatus(automationId, runId, 'failed', at)
      }
    }
    fail('a', 'over', 3, 100)
    fail('b', 'over', 4, 200)
    fail('a', 'within', 2, 100)
    fail('a', 'old', 3, 10)
    expect(
      store
        .gaveUp(2, 50)
        .map((r) => [r.automationId, r.onceKey, r.failures, r.itemLabel, r.lastOutcome])
    ).toEqual([
      ['b', 'over', 4, '!over', 'failure 4'],
      ['a', 'over', 3, '!over', 'failure 3']
    ])
  })

  it('names the failed key each run still holds, for Retry on a finished run', () => {
    const store = freshStore()
    store.markHandled('a', 'k:1', 'run-1', 1)
    store.markHandled('a', 'k:2', 'run-2', 1)
    store.setHandledStatus('a', 'run-1', 'failed', 2)
    store.setHandledStatus('a', 'run-2', 'done', 2)
    expect(store.failedKeysOf(['run-1', 'run-2', 'run-3'])).toEqual(new Map([['run-1', 'k:1']]))
  })

  it('records a tick with its item decisions', () => {
    const store = freshStore()
    const tick = store.startTick('fix-failed-ci', 1000)
    store.recordDecisions(
      tick,
      [decision('!1561', 'started'), decision('!1574', 'skipped')],
      new Map([['!1561', 'run-1']])
    )
    store.finishTick(tick, 'ok', null, { started: 1, skipped: 1 }, 2000, [
      "WEB-9 isn't readable in Linear; skipped"
    ])
    expect(store.lastTick('fix-failed-ci')).toMatchObject({
      id: tick,
      status: 'ok',
      counts: { started: 1, skipped: 1 },
      warnings: ["WEB-9 isn't readable in Linear; skipped"]
    })
    const quiet = store.startTick('fix-failed-ci', 3000)
    store.finishTick(quiet, 'ok', null, {}, 3001)
    expect(store.listTicks('fix-failed-ci', 1)[0].warnings).toEqual([])
    expect(store.tickItems(tick).map((i) => [i.itemKey, i.verdict, i.runId])).toEqual([
      ['!1561', 'started', 'run-1'],
      ['!1574', 'skipped', null]
    ])
    expect(store.tickItems(tick)[0].checks).toEqual([
      { check: 'Clean', ok: true, reason: 'No uncommitted changes' }
    ])
  })

  it('remembers handled once_per keys and seen items per automation', () => {
    const store = freshStore()
    store.markHandled('a', '1561:1', 'run-1', 1)
    store.markSeen('a', '!1561', 1)
    expect(store.handledKeys('a')).toEqual(new Set(['1561:1']))
    expect(store.handledKeys('b')).toEqual(new Set())
    expect(store.seenKeys('a')).toEqual(new Set(['!1561']))
    store.unmarkHandled('a', '1561:1')
    expect(store.handledKeys('a')).toEqual(new Set())
  })

  it('tracks runs and their steps, and finds open ones in a worktree', () => {
    const store = freshStore()
    store.runs.create({
      id: 'run-1',
      automationId: 'a',
      tickId: null,
      itemKey: '!1561',
      itemLabel: '!1561 web-1493',
      worktreePath: '/wt/1',
      startedAt: 1
    })
    store.runs.createStep({
      runId: 'run-1',
      idx: 0,
      name: 'step1',
      agent: 'claude',
      skill: 'fix-gitlab-ci',
      startedAt: 1
    })
    store.runs.updateStep('run-1', 0, {
      status: 'running',
      terminalHandle: 'term_1',
      paneKey: 'tab:leaf'
    })
    expect(store.runs.runningSteps().map((s) => s.terminalHandle)).toEqual(['term_1'])
    expect(store.runs.sessionStepsIn('a', '/wt/1', 0)).toHaveLength(1)
    expect(store.runs.runningCount('a')).toBe(1)
    store.runs.updateStep('run-1', 0, {
      status: 'done',
      finishedAt: 5,
      costUsd: 1.25,
      tokens: 1000
    })
    store.runs.update('run-1', {
      status: 'done',
      finishedAt: 5,
      costUsd: 1.25,
      tokens: 1000,
      outcome: 'Done'
    })
    expect(store.runs.runningSteps()).toEqual([])
    expect(store.runs.runningCount('a')).toBe(0)
  })

  // session: none_open reads open steps and finished ones whose tab may still be open (7-day bound).
  it('finds the session steps of an automation in a worktree', () => {
    const store = freshStore()
    const step = (
      id: string,
      automationId: string,
      worktreePath: string,
      patch: Parameters<typeof store.runs.updateStep>[2]
    ) => {
      store.runs.create({
        id,
        automationId,
        tickId: null,
        itemKey: id,
        itemLabel: id,
        worktreePath,
        startedAt: 1
      })
      store.runs.createStep({
        runId: id,
        idx: 0,
        name: 's',
        agent: 'claude',
        skill: null,
        startedAt: 1
      })
      store.runs.updateStep(id, 0, patch)
    }
    step('starting', 'a', '/wt', {})
    step('running', 'a', '/wt', { status: 'running', terminalHandle: 't_run' })
    step('done-recent', 'a', '/wt', { status: 'done', terminalHandle: 't_done', finishedAt: 100 })
    step('failed-recent', 'a', '/wt', {
      status: 'failed',
      terminalHandle: 't_fail',
      finishedAt: 100
    })
    step('done-old', 'a', '/wt', { status: 'done', terminalHandle: 't_old', finishedAt: 99 })
    step('failed-no-terminal', 'a', '/wt', { status: 'failed', finishedAt: 100 })
    step('other-automation', 'b', '/wt', { status: 'running', terminalHandle: 't_b' })
    step('other-worktree', 'a', '/elsewhere', { status: 'running', terminalHandle: 't_e' })
    expect(store.runs.sessionStepsIn('a', '/wt', 100).map((s) => s.runId)).toEqual([
      'done-recent',
      'failed-recent',
      'running',
      'starting'
    ])
  })

  // Spec §7: ticks and items for 30 days, runs and steps indefinitely.
  it('finishedSince lists runs that finished at or after a time, oldest finish first', () => {
    const store = PilotStore.open(':memory:')
    store.runs.create({
      id: 'a',
      automationId: 'x',
      tickId: null,
      itemKey: 'k1',
      itemLabel: 'one',
      worktreePath: null,
      startedAt: 1
    })
    store.runs.create({
      id: 'b',
      automationId: 'x',
      tickId: null,
      itemKey: 'k2',
      itemLabel: 'two',
      worktreePath: null,
      startedAt: 2
    })
    store.runs.create({
      id: 'c',
      automationId: 'x',
      tickId: null,
      itemKey: 'k3',
      itemLabel: 'three',
      worktreePath: null,
      startedAt: 3
    })
    store.runs.update('a', { status: 'done', finishedAt: 50 })
    store.runs.update('b', { status: 'done', finishedAt: 40 })
    expect(store.runs.finishedSince(45).map((r) => r.id)).toEqual(['a'])
    expect(store.runs.finishedSince(0).map((r) => r.id)).toEqual(['b', 'a'])
  })

  it('removes ticks older than 30 days with their items, keeping runs and each newest tick', () => {
    const store = freshStore()
    const now = TICK_RETENTION_MS + 1_000
    const old = store.startTick('a', 1)
    store.recordDecisions(old, [decision('!1', 'started')], new Map([['!1', 'run-old']]))
    store.finishTick(old, 'ok', null, {}, 2)
    store.runs.create({
      id: 'run-old',
      automationId: 'a',
      tickId: old,
      itemKey: '!1',
      itemLabel: '!1',
      worktreePath: null,
      startedAt: 1
    })
    const newer = store.startTick('a', 500)
    store.finishTick(newer, 'ok', null, {}, 501)
    const recent = store.startTick('a', now - 1)
    store.finishTick(recent, 'ok', null, {}, now)
    const lonely = store.startTick('b', 1)
    store.finishTick(lonely, 'ok', null, {}, 2)
    expect(store.housekeep(now)).toEqual({ interrupted: 0, pruned: 2 })
    expect(store.listTicks('a', 10).map((t) => t.id)).toEqual([recent])
    expect(store.tickItems(old)).toEqual([])
    expect(store.runs.get('run-old')?.tickId).toBe(old)
    // An automation that hasn't ticked in 30 days keeps its last tick.
    expect(store.lastTick('b')?.id).toBe(lonely)
  })

  it('closes a tick still running after an hour as interrupted, and leaves a younger one', () => {
    const store = freshStore()
    const now = 10 * STUCK_TICK_MS
    const stuck = store.startTick('a', now - STUCK_TICK_MS - 1)
    const young = store.startTick('b', now - 1_000)
    expect(store.housekeep(now)).toEqual({ interrupted: 1, pruned: 0 })
    expect(store.lastTick('a')).toMatchObject({
      id: stuck,
      status: 'failed',
      error: INTERRUPTED,
      finishedAt: now
    })
    expect(store.lastTick('b')).toMatchObject({ id: young, status: 'running' })
  })

  it('keeps data across close and reopen of the same file', () => {
    const path = join(mkdtempSync(join(tmpdir(), 'pilot-store-')), 'pilot-automations.db')
    const first = PilotStore.open(path)
    first.markHandled('a', 'k:1', null, 1)
    first.markSeen('a', '!1', 1)
    first.close()
    const second = PilotStore.open(path)
    expect(second.handledKeys('a')).toEqual(new Set(['k:1']))
    expect(second.seenKeys('a')).toEqual(new Set(['!1']))
    second.close()
  })

  it('tolerates repeated and missing keys and empty decision lists', () => {
    const store = freshStore()
    store.markHandled('a', 'k:1', 'run-1', 1)
    expect(() => store.markHandled('a', 'k:1', 'run-2', 2)).not.toThrow()
    expect(store.handledKeys('a')).toEqual(new Set(['k:1']))
    expect(() => store.unmarkHandled('a', 'missing')).not.toThrow()
    const tick = store.startTick('a', 1)
    expect(() => store.recordDecisions(tick, [], new Map())).not.toThrow()
    expect(store.tickItems(tick)).toEqual([])
  })

  it('unmarks only the once_per key a given run holds', () => {
    const store = freshStore()
    store.markHandled('a', 'k:1', 'run-1', 1)
    store.markHandled('a', 'k:2', 'run-2', 1)
    store.markHandled('a', 'k:3', null, 1)
    store.markHandled('b', 'k:1', 'run-1', 1)
    store.unmarkHandledForRun('a', 'run-1')
    expect(store.handledKeys('a')).toEqual(new Set(['k:2', 'k:3']))
    expect(store.handledKeys('b')).toEqual(new Set(['k:1']))
  })

  it('finds steps stuck starting without a terminal since before a cutoff', () => {
    const store = freshStore()
    const add = (id: string, startedAt: number) => {
      store.runs.create({
        id,
        automationId: 'a',
        tickId: null,
        itemKey: id,
        itemLabel: id,
        worktreePath: null,
        startedAt
      })
      store.runs.createStep({
        runId: id,
        idx: 0,
        name: 's',
        agent: 'claude',
        skill: null,
        startedAt
      })
    }
    add('stale', 10)
    add('young', 500)
    add('launched', 10)
    store.runs.updateStep('launched', 0, { terminalHandle: 'term_1' })
    add('failed', 10)
    store.runs.updateStep('failed', 0, { status: 'failed' })
    expect(store.runs.staleStartingSteps(100).map((s) => s.runId)).toEqual(['stale'])
    expect(store.runs.get('stale')).toMatchObject({ id: 'stale', status: 'running' })
    expect(store.runs.get('missing')).toBeNull()
  })

  it('finds running runs that never got a step since before a cutoff', () => {
    const store = freshStore()
    const run = (id: string, startedAt: number) =>
      store.runs.create({
        id,
        automationId: 'a',
        tickId: null,
        itemKey: id,
        itemLabel: id,
        worktreePath: null,
        startedAt
      })
    run('bare', 10)
    run('young', 500)
    run('stepped', 10)
    store.runs.createStep({
      runId: 'stepped',
      idx: 0,
      name: 's',
      agent: 'claude',
      skill: null,
      startedAt: 10
    })
    run('ended', 10)
    store.runs.update('ended', { status: 'failed' })
    expect(store.runs.staleRunsWithoutSteps(100).map((r) => r.id)).toEqual(['bare'])
  })

  it('moves a step to running only while it is still starting', () => {
    const store = freshStore()
    store.runs.create({
      id: 'r',
      automationId: 'a',
      tickId: null,
      itemKey: 'r',
      itemLabel: 'r',
      worktreePath: null,
      startedAt: 1
    })
    store.runs.createStep({
      runId: 'r',
      idx: 0,
      name: 's',
      agent: 'claude',
      skill: null,
      startedAt: 1
    })
    store.runs.updateStep('r', 0, { status: 'failed', error: 'swept' })
    expect(store.runs.updateStartingStep('r', 0, { status: 'running', terminalHandle: 't' })).toBe(
      false
    )
    expect(store.runs.steps('r')[0]).toMatchObject({ status: 'failed', terminalHandle: null })
  })

  it("refuses a file that isn't a database", () => {
    const path = join(mkdtempSync(join(tmpdir(), 'pilot-store-')), 'pilot-automations.db')
    writeFileSync(path, 'not sqlite at all, just text that is long enough to have a header')
    expect(() => PilotStore.open(path)).toThrow(/not a database/)
  })

  it('records decisions atomically and in insertion order', () => {
    const store = freshStore()
    const tick = store.startTick('a', 1)
    expect(() =>
      store.recordDecisions(tick, [decision('!2', 'started'), decision('!2', 'skipped')], new Map())
    ).toThrow()
    expect(store.tickItems(tick)).toEqual([])
    store.recordDecisions(
      tick,
      [decision('!9', 'started'), decision('!10', 'skipped'), decision('!1', 'notdue')],
      new Map()
    )
    expect(store.tickItems(tick).map((i) => i.itemKey)).toEqual(['!9', '!10', '!1'])
  })
})
