import { describe, expect, it } from 'vitest'
import type { RunRow } from '../../shared/api-types'
import { parseAutomationYaml } from '../../shared/definition/parse'
import { holdHomeForStep } from '../envs/home-hold'
import { PilotStore } from '../store/store'
import type { StepStartRequest } from './advance'
import { makeShellSteps, type ShellResult, type ShellSpec } from './shell-step'

const parsed = parseAutomationYaml(
  'name: Fix CI\nrepo: r\nschedule: manual\nitems: { kind: merge_request }\n' +
    'workspace: { env: { worktree: "{worktree.path}", writes: true } }\n' +
    'steps:\n  - { name: merge_back, agent: shell, run: ./merge-back.sh, hold_home: true }\n  - { name: note, agent: shell, run: ./note.sh }\n',
  '/a/ci.yaml'
)
if (!parsed.ok) {
  throw new Error(parsed.errors.join('\n'))
}
const DEF = parsed.definition
const DONE: ShellResult = { code: 0, signal: null, stdout: '', stderr: '', timedOut: false }

function setup(base: NodeJS.ProcessEnv = { PATH: '/usr/bin' }) {
  const store = PilotStore.open(':memory:')
  const specs: ShellSpec[] = []
  const finish: ((ending: ShellResult | Error) => void)[] = []
  const steps = makeShellSteps({
    store,
    now: () => 10,
    log: () => {},
    workspaceOf: async (req) => ({ path: req.run.worktreePath ?? '/nowhere' }),
    envOf: () => ({}),
    engineEnv: { binDir: '/bin-dir', dataDir: '/data' },
    timeoutOf: () => null,
    onEnded: () => {},
    baseEnv: base,
    holdHome: (req) =>
      req.definition.steps[req.idx].holdHome
        ? holdHomeForStep(store.runs, req.run, req.idx, (id) => `${id} job`)
        : null,
    releaseHome: (req) => store.runs.envs.releaseHome(req.run.id, req.idx),
    run: (spec) => {
      specs.push(spec)
      return new Promise<ShellResult>((resolve, reject) => {
        finish.push((ending) => (ending instanceof Error ? reject(ending) : resolve(ending)))
      })
    }
  })
  return { store, specs, finish, steps }
}

// An env run that worked in a throwaway: its home, /wt/a, is free unless another run holds it.
function envRun(store: PilotStore, id: string): RunRow {
  store.runs.create({
    id,
    automationId: 'ci',
    tickId: null,
    itemKey: `mr:${id}`,
    itemLabel: id,
    worktreePath: '/wt/a',
    startedAt: 1
  })
  store.runs.envs.begin(id, '/wt/a', {})
  store.runs.envs.ready(id, {
    mode: 'throwaway',
    reason: '',
    path: `/agents/agents-${id}`,
    home: '/wt/a',
    worktreeId: `repo::/agents/agents-${id}`,
    sha: null,
    envFile: null,
    vars: {},
    stack: null
  })
  return store.runs.get(id)!
}
const req = (run: RunRow, idx = 0): StepStartRequest => ({ run, definition: DEF, idx, fields: {} })

describe('hold_home', () => {
  it('held by another run: PILOT_HOME_BUSY names it, and no claim is taken', async () => {
    const t = setup()
    t.store.runs.create({
      id: 'rv-1',
      automationId: 'review',
      tickId: null,
      itemKey: 'wt:a',
      itemLabel: 'a',
      worktreePath: '/wt/a',
      startedAt: 1
    })
    await t.steps.start(req(envRun(t.store, 'r1')))
    expect(t.specs[0].env.PILOT_HOME_BUSY).toBe('review job is working in /wt/a (Pilot run rv-1)')
    expect(t.store.runs.runningInWorktree('/wt/a').map((r) => r.id)).toEqual(['rv-1'])
  })

  it.each([
    ['done', DONE],
    ['failed (exit 1)', { ...DONE, code: 1 }],
    ['timed out', { ...DONE, code: null, signal: 'SIGTERM', timedOut: true }],
    ['with its runner throwing', new Error('spawn failed')]
  ] as const)(
    'free, then the step ends %s: held during it, released after',
    async (_name, ending) => {
      const t = setup()
      await t.steps.start(req(envRun(t.store, 'r1')))
      expect('PILOT_HOME_BUSY' in t.specs[0].env).toBe(false)
      expect(t.store.runs.runningInWorktree('/wt/a').map((r) => r.id)).toEqual(['r1'])
      t.finish[0](ending)
      await t.steps.settled()
      expect(t.store.runs.runningInWorktree('/wt/a')).toEqual([])
    }
  )

  it('two such steps at once: one holds the home, the other is told who does', async () => {
    const t = setup()
    const a = envRun(t.store, 'r1')
    const b = envRun(t.store, 'r2')
    await Promise.all([t.steps.start(req(a)), t.steps.start(req(b))])
    const busy = t.specs.map((spec) => spec.env.PILOT_HOME_BUSY ?? null)
    expect(busy.filter((value) => value === null)).toHaveLength(1)
    expect(busy.filter((value) => value !== null)).toEqual([
      expect.stringMatching(/^ci job is working in \/wt\/a \(Pilot run r[12]\)$/)
    ])
    expect(t.store.runs.runningInWorktree('/wt/a')).toHaveLength(1)
  })

  it('a step without hold_home takes no claim, and an inherited PILOT_HOME_BUSY never reaches it', async () => {
    const t = setup({ PATH: '/usr/bin', PILOT_HOME_BUSY: 'stale' })
    await t.steps.start(req(envRun(t.store, 'r1'), 1))
    expect('PILOT_HOME_BUSY' in t.specs[0].env).toBe(false)
    expect(t.store.runs.runningInWorktree('/wt/a')).toEqual([])
  })
})
