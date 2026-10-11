import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { loadDefinitions } from '../definitions/loader'
import { PilotStore } from '../store/store'
import { activity, getAutomation, listAutomations, validateYaml } from './handlers'

const YAML =
  'name: Fix CI\nrepo: web-platform\nschedule: "10 * * * *"\nchecks: [ { worktree: clean } ]\nsteps: [ { agent: claude, prompt: x } ]\n'

function context() {
  const dir = mkdtempSync(join(tmpdir(), 'pilot-rpc-'))
  writeFileSync(join(dir, 'ci.yaml'), YAML)
  writeFileSync(join(dir, 'bad.yaml'), 'name: [')
  const store = PilotStore.open(join(dir, 'db.sqlite'))
  const loaded = loadDefinitions([dir])
  return {
    dir,
    store,
    ctx: {
      processKind: 'main' as const,
      store,
      dirs: [dir],
      loaded: () => loaded,
      reload: () => loaded,
      scheduler: { nextTickAt: () => Date.UTC(2026, 9, 10, 20, 10) } as never
    }
  }
}

describe('Pilot API handlers', () => {
  it('lists automations with their last tick and file errors', () => {
    const { ctx, store } = context()
    const tick = store.startTick('ci', false, 1)
    store.finishTick(tick, 'ok', null, { started: 1 }, 2)
    const payload = listAutomations(ctx)
    expect(payload.automations.map((a) => [a.id, a.agent, a.itemKind, a.lastTick?.counts])).toEqual(
      [['ci', 'claude', 'Runs once', { started: 1 }]]
    )
    expect(payload.errors.map((e) => e.file.endsWith('bad.yaml'))).toEqual([true])
  })

  it('shows the newest tick as the last tick, saying whether it was a dry run', () => {
    const { ctx, store } = context()
    store.finishTick(store.startTick('ci', false, 1), 'ok', null, {}, 2)
    store.finishTick(store.startTick('ci', true, 5), 'ok', null, {}, 6)
    expect(listAutomations(ctx).automations[0].lastTick).toMatchObject({ dryRun: true })
  })

  it('returns a definition with its YAML text and check names', () => {
    const { ctx } = context()
    expect(getAutomation(ctx, 'ci')).toMatchObject({ yaml: YAML, checkNames: ['Clean'] })
    expect(() => getAutomation(ctx, 'nope')).toThrow('No automation "nope"')
  })

  it('returns ticks with their items and runs, newest first', () => {
    const { ctx, store } = context()
    const t1 = store.startTick('ci', false, 1)
    store.finishTick(t1, 'ok', null, {}, 1)
    const t2 = store.startTick('ci', true, 2)
    store.finishTick(t2, 'ok', null, {}, 2)
    store.runs.create({
      id: 'r1',
      automationId: 'ci',
      tickId: t1,
      itemKey: '!1',
      itemLabel: '!1',
      worktreePath: null,
      startedAt: 1
    })
    store.runs.createStep({
      runId: 'r1',
      idx: 0,
      name: 's',
      agent: 'claude',
      skill: null,
      startedAt: 1
    })
    const ticks = activity(ctx, 'ci', 10)
    expect(ticks.map((t) => [t.id, t.dryRun])).toEqual([
      [t2, true],
      [t1, false]
    ])
    expect(ticks[1].runs.map((r) => [r.id, r.steps.map((s) => s.name)])).toEqual([['r1', ['s']]])
    expect(activity(ctx, 'ci', 1)).toHaveLength(1)
  })

  it('returns no activity for an unknown id', () => {
    expect(activity(context().ctx, 'nope', 10)).toEqual([])
  })

  it('validates YAML without saving it', () => {
    expect(validateYaml('name: x', 'draft.yaml').ok).toBe(false)
    const ok = validateYaml(YAML, 'my-draft.yaml')
    expect(ok.ok && ok.definition.id).toBe('my-draft')
  })
})
