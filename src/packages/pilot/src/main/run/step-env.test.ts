import { describe, expect, it } from 'vitest'
import type { RunRow } from '../../shared/api-types'
import { parseAutomationYaml } from '../../shared/definition/parse'
import { PilotStore } from '../store/store'
import type { StepStartRequest } from './advance'
import { makeShellSteps, type ShellSpec } from './shell-step'
import { pilotStepEnv } from './step-launch-plan'

function definition(stepEnv: string) {
  const parsed = parseAutomationYaml(
    `name: n\nrepo: r\nschedule: manual\nitems: { kind: merge_request }\nworkspace: { env: { worktree: "{worktree.path}" } }\n` +
      `steps:\n  - { name: check, agent: shell, run: ./check.sh${stepEnv} }\n`,
    '/a/n.yaml'
  )
  if (!parsed.ok) {
    throw new Error(parsed.errors.join('\n'))
  }
  return parsed.definition
}

// One shell step of an env run working in its throwaway, /agents/agents-r1: the spec it was started with.
async function startOnce(runEnv: Record<string, string>, stepEnv: string): Promise<ShellSpec> {
  const store = PilotStore.open(':memory:')
  store.runs.create({
    id: 'r1',
    automationId: 'n',
    tickId: null,
    itemKey: 'mr:1',
    itemLabel: '!1',
    worktreePath: '/agents/agents-r1',
    startedAt: 1
  })
  const specs: ShellSpec[] = []
  const steps = makeShellSteps({
    store,
    now: () => 10,
    log: () => {},
    workspaceOf: async (req) => ({ path: req.run.worktreePath ?? '/nowhere' }),
    envOf: (req) =>
      pilotStepEnv({
        runId: req.run.id,
        stepName: 'check',
        stepIdx: req.idx,
        automationId: 'n',
        itemKey: req.run.itemKey,
        powers: []
      }),
    runEnvOf: () => runEnv,
    engineEnv: { binDir: '/bin-dir', dataDir: '/data' },
    timeoutOf: () => null,
    onEnded: () => {},
    baseEnv: { PATH: '/usr/bin' },
    run: async (spec) => {
      specs.push(spec)
      return { code: 0, signal: null, stdout: '', stderr: '', timedOut: false }
    }
  })
  const req: StepStartRequest = {
    run: store.runs.get('r1') as RunRow,
    definition: definition(stepEnv),
    idx: 0,
    fields: {}
  }
  await steps.start(req)
  await steps.settled()
  return specs[0]
}

describe("an env run's shell step", () => {
  it.each([
    [
      "the env's variable reaches the step",
      { API_URL: 'http://localhost:8123' },
      '',
      { API_URL: 'http://localhost:8123' }
    ],
    [
      "Pilot's own names win over the env's",
      { PILOT_RUN_ID: 'forged', PATH: '/evil' },
      '',
      { PILOT_RUN_ID: 'r1' }
    ],
    [
      "the step's own env: wins over the env's",
      { API_URL: 'http://a' },
      ', env: { API_URL: "http://b" }',
      { API_URL: 'http://b' }
    ]
  ])('%s', async (_name, runEnv, stepEnv, expected) => {
    const spec = await startOnce(runEnv, stepEnv)
    expect(spec.env).toMatchObject(expected)
    expect(spec.env.PATH?.startsWith('/bin-dir:')).toBe(true)
    expect(spec.cwd).toBe('/agents/agents-r1')
  })
})
