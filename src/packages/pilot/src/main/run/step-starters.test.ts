import { describe, expect, it, vi } from 'vitest'
import type { RunRow } from '../../shared/api-types'
import { parseAutomationYaml } from '../../shared/definition/parse'
import type { StepStartRequest } from './advance'
import { agentStepStarter, stepStarterFor } from './step-starters'

const parsed = parseAutomationYaml(
  'name: Pull dev\nrepo: web-platform\nschedule: manual\nsteps:\n  - { name: pull, agent: shell, run: git pull }\n  - { name: tell, agent: claude, prompt: Say what changed }\n',
  '/a/pull-dev.yaml'
)
if (!parsed.ok) {
  throw new Error(parsed.errors.join('\n'))
}
const def = parsed.definition
const run = {
  id: 'run-1',
  itemKey: 'repo:web-platform',
  itemLabel: 'web-platform',
  automationId: 'pull-dev',
  worktreePath: '/repo/wt',
  worktreeId: 'wt-1'
} as RunRow
const req = (idx: number, over: Partial<RunRow> = {}): StepStartRequest => ({
  run: { ...run, ...over },
  definition: def,
  idx,
  fields: { 'repo.path': '/repo' }
})

describe('agentStepStarter', () => {
  it("launches with the run, the step's index, item key and label, the fields and the run's recorded workspace", async () => {
    const launch = vi.fn(async () => ({ terminalHandle: 't', paneKey: 'p' }))
    await agentStepStarter(launch)(req(1))
    expect(launch).toHaveBeenCalledWith({
      runId: 'run-1',
      definition: def,
      stepIdx: 1,
      itemKey: 'repo:web-platform',
      label: 'web-platform',
      fields: { 'repo.path': '/repo' },
      workspace: {
        kind: 'main_checkout',
        path: '/repo/wt',
        worktreeId: 'wt-1',
        selector: 'id:wt-1',
        created: false,
        env: {},
        disposable: false
      }
    })
  })

  it.each([
    ['throwaway', true],
    ['in_place', false]
  ])('hands an %s env run its variables, disposable %s', async (mode, disposable) => {
    const launch = vi.fn(async () => ({ terminalHandle: 't', paneKey: 'p' }))
    const env = { mode, vars: { A: 'b' } } as unknown as RunRow['env']
    await agentStepStarter(launch)(req(1, { env }))
    expect(launch).toHaveBeenCalledWith(
      expect.objectContaining({
        workspace: expect.objectContaining({ path: '/repo/wt', env: { A: 'b' }, disposable })
      })
    )
  })

  it('selects the workspace by path when the run has no worktree id', async () => {
    const launch = vi.fn(async () => ({ terminalHandle: 't', paneKey: 'p' }))
    await agentStepStarter(launch)(req(1, { worktreeId: null }))
    expect(launch).toHaveBeenCalledWith(
      expect.objectContaining({ workspace: expect.objectContaining({ selector: 'path:/repo/wt' }) })
    )
  })

  it('refuses a run that has no recorded workspace, naming the run', async () => {
    const launch = vi.fn()
    await expect(
      agentStepStarter(launch)(req(1, { worktreePath: null, worktreeId: null }))
    ).rejects.toThrow('Run run-1 has no workspace')
    expect(launch).not.toHaveBeenCalled()
  })
})

describe('stepStarterFor', () => {
  it.each([
    ['a shell step to the shell starter', 0, 'shell'],
    ['an agent step to the agent starter', 1, 'agent']
  ])('sends %s', async (_n, idx, which) => {
    const calls: string[] = []
    const start = stepStarterFor({
      agent: async () => void calls.push('agent'),
      shell: async () => void calls.push('shell')
    })
    await start(req(idx))
    expect(calls).toEqual([which])
  })
})

describe('the 32 KB cap on a rendered result', () => {
  const capped = parseAutomationYaml(
    'name: Fix CI\nrepo: web-platform\nschedule: manual\nsteps:\n' +
      '  - { name: context, agent: shell, run: ./context.sh }\n' +
      '  - { name: fix, agent: claude, prompt: "Fix it. The context: {steps.context.result}" }\n' +
      '  - { name: push, agent: shell, run: ./push.sh, env: { CTX: "{previous.result}" } }\n' +
      '  - { name: tell, agent: claude, prompt: Say what changed }\n',
    '/a/fix-ci.yaml'
  )
  if (!capped.ok) {
    throw new Error(capped.errors.join('\n'))
  }
  // Compact JSON of a string, `bytes` long.
  const json = (bytes: number) => `"${'x'.repeat(bytes - 2)}"`
  const starter = () => {
    const calls: string[] = []
    const start = stepStarterFor({
      agent: async () => void calls.push('agent'),
      shell: async () => void calls.push('shell')
    })
    return { calls, start }
  }
  const at = (idx: number, fields: Record<string, string>): StepStartRequest => ({
    ...req(idx),
    definition: capped.definition,
    fields
  })

  it.each([
    [
      'a prompt',
      1,
      { 'steps.context.result': json(40 * 1024) },
      'steps.context.result is 40 KB, over the 32 KB cap'
    ],
    [
      'an env: value',
      2,
      { 'previous.result': json(33 * 1024) },
      'previous.result is 33 KB, over the 32 KB cap'
    ],
    [
      'multi-byte text, counted in bytes',
      1,
      { 'steps.context.result': `"${'é'.repeat(17 * 1024)}"` },
      'steps.context.result is 35 KB, over the 32 KB cap'
    ]
  ])(
    'fails a step whose %s renders a result over the cap, starting nothing',
    async (_n, idx, fields, error) => {
      const { calls, start } = starter()
      await expect(start(at(idx, fields))).rejects.toThrow(error)
      expect(calls).toEqual([])
    }
  )

  it.each([
    ['exactly 32 KB', 1, { 'steps.context.result': json(32 * 1024) }],
    ['a large result the step never renders', 3, { 'steps.context.result': json(40 * 1024) }]
  ])('starts a step with %s', async (_n, idx, fields) => {
    const { calls, start } = starter()
    await start(at(idx, fields))
    expect(calls).toHaveLength(1)
  })
})
