import { describe, expect, it, vi } from 'vitest'
import type { OrcaRuntimeService } from '../../../../../main/runtime/orca-runtime'
import type { ItemDecision } from '../../shared/api-types'
import { parseAutomationYaml } from '../../shared/definition/parse'
import { PilotStore } from '../store/store'
import { buildPrompt, makeLauncher } from './launch'

const parsed = parseAutomationYaml(
  'name: Fix failed CI on my MRs\nrepo: r\nschedule: manual\nsteps: [ { agent: claude, skill: fix-gitlab-ci, prompt: "Fix pipeline {mr.pipeline} on !{mr.iid}." } ]\n',
  '/a/fix-failed-ci.yaml'
)
if (!parsed.ok) {
  throw new Error('setup')
}
const def = parsed.definition

function decisionWith(fields: ItemDecision['fields']): ItemDecision {
  return {
    key: '!1561',
    label: '!1561 web-1493',
    verdict: 'started',
    reason: '',
    checks: [],
    onceKey: '',
    fields
  }
}
const decision = decisionWith({ 'mr.iid': 1561, 'mr.pipeline': 99, 'worktree.path': '/wt' })

describe('buildPrompt', () => {
  it('names the automation, run and skill, then the rendered prompt', () => {
    expect(buildPrompt(def, decision, 'fix-failed-ci-202610101910-1')).toBe(
      [
        'Started by the Pilot automation "Fix failed CI on my MRs" (run fix-failed-ci-202610101910-1) for !1561 web-1493.',
        'Use the fix-gitlab-ci skill.',
        '',
        'Fix pipeline 99 on !1561.'
      ].join('\n')
    )
  })

  it('keeps a placeholder literal when its field is missing', () => {
    const text = buildPrompt(def, decisionWith({ 'mr.iid': 1 }), 'r')
    expect(text).toContain('Fix pipeline {mr.pipeline} on !1.')
  })
})

function setup(launch: (sel: string, opts: unknown) => Promise<unknown>) {
  const store = PilotStore.open(':memory:')
  store.runs.create({
    id: 'run-1',
    automationId: 'a',
    tickId: null,
    itemKey: '!1561',
    itemLabel: '!1561',
    worktreePath: '/wt',
    startedAt: 1
  })
  const runtime = { launchAgentTerminal: launch } as unknown as OrcaRuntimeService
  return { store, launcher: makeLauncher(runtime, store, () => 7) }
}
const request = { runId: 'run-1', definition: def, decision }

describe('makeLauncher', () => {
  it('launches in the worktree by path and records a running step with its handle', async () => {
    const launch = vi.fn(async () => ({ handle: 'term_1', paneKey: 'tab:leaf' }))
    const { store, launcher } = setup(launch)
    expect(await launcher(request)).toEqual({ terminalHandle: 'term_1', paneKey: 'tab:leaf' })
    expect(launch).toHaveBeenCalledWith('path:/wt', expect.objectContaining({ agent: 'claude' }))
    expect(store.runs.steps('run-1')[0]).toMatchObject({
      status: 'running',
      terminalHandle: 'term_1',
      paneKey: 'tab:leaf',
      startedAt: 7
    })
  })

  it('says the worktree is gone when the fact is missing or the runtime no longer lists it', async () => {
    const missing = setup(async () => ({ handle: 'x', paneKey: 'y' }))
    await expect(
      missing.launcher({ ...request, decision: decisionWith({ 'worktree.path': null }) })
    ).rejects.toThrow('worktree is gone')
    const unlisted = setup(async () => {
      throw new Error('selector_not_found')
    })
    await expect(unlisted.launcher(request)).rejects.toThrow('worktree is gone')
    expect(unlisted.store.runs.steps('run-1')[0]).toMatchObject({ status: 'failed' })
  })

  it('names the orphaned terminal when it cannot record the step after launching', async () => {
    const { store, launcher } = setup(async () => ({ handle: 'term_9', paneKey: 'p' }))
    const real = store.runs.updateStep.bind(store.runs)
    let first = true
    store.runs.updateStep = (runId, idx, patch) => {
      if (first) {
        first = false
        throw new Error('disk full')
      }
      real(runId, idx, patch)
    }
    await expect(launcher(request)).rejects.toThrow(/term_9.*disk full/)
    expect(store.runs.steps('run-1')[0]).toMatchObject({ status: 'failed' })
  })
})
