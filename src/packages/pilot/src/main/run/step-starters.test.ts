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
        created: false
      }
    })
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
