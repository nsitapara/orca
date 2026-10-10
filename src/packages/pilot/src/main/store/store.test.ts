import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import type { ItemDecision } from '../../shared/api-types'
import { PilotStore } from './store'

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
  it('creates schema v1 and reopens without migrating twice', () => {
    const dir = mkdtempSync(join(tmpdir(), 'pilot-store-'))
    const path = join(dir, 'pilot-automations.db')
    PilotStore.open(path).close()
    const again = PilotStore.open(path)
    expect(again.schemaVersion()).toBe(1)
    again.close()
  })

  it('records a tick with its item decisions', () => {
    const store = freshStore()
    const tick = store.startTick('fix-failed-ci', false, 1000)
    store.recordDecisions(
      tick,
      [decision('!1561', 'started'), decision('!1574', 'skipped')],
      new Map([['!1561', 'run-1']])
    )
    store.finishTick(tick, 'ok', null, { started: 1, skipped: 1 }, 2000)
    expect(store.lastTick('fix-failed-ci')).toMatchObject({
      id: tick,
      status: 'ok',
      dryRun: false,
      counts: { started: 1, skipped: 1 }
    })
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
    expect(store.runs.openStepsIn('a', '/wt/1')).toHaveLength(1)
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
    expect(store.runs.openStepsIn('a', '/wt/1')).toHaveLength(0)
    expect(store.runs.runningCount('a')).toBe(0)
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
    const tick = store.startTick('a', true, 1)
    expect(() => store.recordDecisions(tick, [], new Map())).not.toThrow()
    expect(store.tickItems(tick)).toEqual([])
  })

  it('records decisions atomically and in insertion order', () => {
    const store = freshStore()
    const tick = store.startTick('a', false, 1)
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
