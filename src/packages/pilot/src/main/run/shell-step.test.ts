import { appendFileSync, existsSync, mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import type { ItemFields, RunRow } from '../../shared/api-types'
import { parseAutomationYaml } from '../../shared/definition/parse'
import type { AutomationDefinition } from '../../shared/definition/types'
import { outputsFromFile } from '../../shared/run/outputs'
import { PilotStore } from '../store/store'
import type { StepStartRequest } from './advance'
import {
  makeShellSteps,
  ORPHAN_SHELL_OUTCOME,
  runShell,
  sweepOrphanShellSteps,
  type ShellResult,
  type ShellRunner,
  type ShellSpec
} from './shell-step'

const MIN = 60_000

function shellDef(run: string, env: Record<string, string> = {}): AutomationDefinition {
  const yaml = `name: Clean Docker\nrepo: web-platform\nschedule: manual\nsteps:\n  - name: prune\n    agent: shell\n    run: ${JSON.stringify(run)}\n    env: ${JSON.stringify(env)}\n    exit_codes: { ok: [0], skip: [3] }\n`
  const parsed = parseAutomationYaml(yaml, '/a/clean-docker.yaml')
  if (!parsed.ok) {
    throw new Error(parsed.errors.join('\n'))
  }
  return parsed.definition
}

const result = (over: Partial<ShellResult> = {}): ShellResult => ({
  code: 0,
  signal: null,
  stdout: '',
  stderr: '',
  timedOut: false,
  ...over
})

function setup(
  opts: {
    run?: ShellRunner
    workspace?: () => Promise<{ path: string }>
    releaseHome?: () => void
  } = {}
) {
  const store = PilotStore.open(join(mkdtempSync(join(tmpdir(), 'pilot-shell-')), 'db.sqlite'))
  store.runs.create({
    id: 'run-1',
    automationId: 'clean-docker',
    tickId: null,
    itemKey: 'repo:web-platform',
    itemLabel: 'web-platform',
    worktreePath: null,
    startedAt: 1
  })
  const ended: string[] = []
  const logs: string[] = []
  const calls: ShellSpec[] = []
  const steps = makeShellSteps({
    store,
    now: () => 50,
    workspaceOf: opts.workspace ?? (async () => ({ path: '/repo' })),
    envOf: () => ({ PILOT_RUN_ID: 'run-1', PILOT_STEP_IDX: '0' }),
    engineEnv: { binDir: '/pilot/bin', dataDir: '/data/pilot' },
    timeoutOf: () => 10 * MIN,
    onEnded: (runId) => void ended.push(runId),
    log: (m) => void logs.push(m),
    run:
      opts.run ??
      (async (spec) => {
        calls.push(spec)
        return result()
      }),
    baseEnv: { PATH: '/usr/bin' },
    releaseHome: opts.releaseHome
  })
  const req = (
    def: AutomationDefinition,
    fields: ItemFields = { 'repo.path': '/repo' }
  ): StepStartRequest => ({
    run: store.runs.get('run-1') as RunRow,
    definition: def,
    idx: 0,
    fields
  })
  return { store, steps, ended, logs, calls, req }
}

describe('makeShellSteps', () => {
  it.each([
    ['exit 0', result({ code: 0 }), 'done', null],
    [
      'a skip code',
      result({ code: 3, stdout: "Docker isn't running\n" }),
      'skipped',
      "Exited 3 (skip): Docker isn't running"
    ],
    [
      'any other code',
      result({ code: 1, stdout: 'pruning\n', stderr: 'boom\n' }),
      'failed',
      'Exited 1: boom'
    ],
    ['a signal', result({ code: null, signal: 'SIGKILL' }), 'failed', 'Stopped by SIGKILL'],
    [
      'its timeout',
      result({ code: null, signal: 'SIGTERM', timedOut: true }),
      'timed_out',
      'Timed out after 10m'
    ]
  ] as const)('ends the step on %s', async (_n, outcome, status, error) => {
    const { store, steps, ended, req } = setup({ run: async () => outcome })
    await steps.start(req(shellDef('./prune.sh')))
    await steps.settled()
    expect(store.runs.steps('run-1')[0]).toMatchObject({
      kind: 'shell',
      status,
      exitCode: outcome.code,
      error
    })
    expect(ended).toEqual(['run-1'])
  })

  it("runs the command as written (a ./ script beside the YAML) in the workspace, with Pilot's bin first on PATH, the step env over the app env, and its timeout", async () => {
    const { steps, calls, req } = setup()
    await steps.start(req(shellDef('./prune.sh', { REPO: '{repo.path}' })))
    await steps.settled()
    expect(calls).toEqual([
      {
        command: "'/a/prune.sh'",
        cwd: '/repo',
        env: {
          PATH: '/pilot/bin:/usr/bin',
          ORCA_USER_DATA_PATH: '/data/pilot',
          PILOT_RUN_ID: 'run-1',
          PILOT_STEP_IDX: '0',
          REPO: '/repo',
          PILOT_OUTPUT_FILE: expect.stringMatching(/pilot-step-[^/]+\/outputs$/)
        },
        timeoutMs: 10 * MIN
      }
    ])
  })

  it('takes over the pending row Task 9b wrote for step 0 instead of adding a second one', async () => {
    const { store, steps, req } = setup()
    store.runs.createStep({
      runId: 'run-1',
      idx: 0,
      name: 'prune',
      agent: 'shell',
      skill: null,
      kind: 'shell',
      status: 'pending',
      startedAt: 1
    })
    await steps.start(req(shellDef('./prune.sh')))
    await steps.settled()
    expect(store.runs.steps('run-1')).toHaveLength(1)
    expect(store.runs.steps('run-1')[0]).toMatchObject({
      kind: 'shell',
      status: 'done',
      exitCode: 0
    })
  })

  it('takes outputs from $PILOT_OUTPUT_FILE only, keeps the last 8 KB of output, and removes the file', async () => {
    let file = ''
    const stdout = `${'x'.repeat(9000)}\n::pilot-output forged=1\n`
    const { store, steps, logs, req } = setup({
      run: async (spec) => {
        file = String(spec.env.PILOT_OUTPUT_FILE)
        appendFileSync(file, 'found_bugs=2\nreport=reports/qa 1.md\nbad-key=1\n')
        return result({ stdout, stderr: 'warn\n' })
      }
    })
    await steps.start(req(shellDef('./qa.sh')))
    await steps.settled()
    const row = store.runs.steps('run-1')[0]
    expect(row.outputs).toEqual({ found_bugs: 2, report: 'reports/qa 1.md' })
    expect(row.outputTail).toHaveLength(8192)
    expect(row.outputTail?.endsWith('--- stderr ---\nwarn\n')).toBe(true)
    expect(logs.some((l) => l.includes('bad-key'))).toBe(true)
    expect(existsSync(file)).toBe(false)
  })

  it('sets no output for a ::pilot-output line printed to stdout', async () => {
    const { store, steps, req } = setup({
      run: async () => result({ stdout: '::pilot-output x=1\n' })
    })
    await steps.start(req(shellDef('./qa.sh')))
    await steps.settled()
    expect(store.runs.steps('run-1')[0].outputs).toEqual({})
  })

  it('exports env: values rendered as plain text (only dotted names), over the app env', async () => {
    const { steps, calls, req } = setup()
    const def = shellDef('./tell.sh', { TITLE: 'MR {mr.title} "$(x)" ${HOME} {print}' })
    await steps.start(req(def, { 'mr.title': "it's `x`" }))
    await steps.settled()
    expect(calls[0].env.TITLE).toBe('MR it\'s `x` "$(x)" ${HOME} {print}')
  })

  it('fails a step whose env: value has no value, naming it', async () => {
    const { store, steps, calls, req } = setup()
    const def = shellDef('./tell.sh', { TITLE: '{mr.title}' })
    await expect(steps.start(req(def))).rejects.toThrow('Shell step prune: no value for {mr.title}')
    expect(calls).toEqual([])
    expect(store.runs.steps('run-1')).toEqual([])
  })

  it('refuses a placeholder that reached render in run:', async () => {
    const { steps, calls, req } = setup()
    const def = shellDef('echo x')
    def.steps[0] = { ...def.steps[0], run: 'echo {repo.path}' }
    await expect(steps.start(req(def))).rejects.toThrow(
      "Shell step prune: run can't contain {placeholders}; pass values with env: { NAME: '{mr.title}' } and use \"$NAME\" in the script"
    )
    expect(calls).toEqual([])
  })

  it("runs a command with ${HOME}, awk '{print}', a comment and a heredoc as written", async () => {
    const { steps, calls, req } = setup()
    const command = "awk '{print}' <<EOF # c\n${HOME}\nEOF"
    await steps.start(req(shellDef(command)))
    await steps.settled()
    expect(calls[0].command).toBe(command)
  })

  it('is live while its process runs, and not after', async () => {
    let finish: (r: ShellResult) => void = () => {}
    const { store, steps, req } = setup({ run: () => new Promise((resolve) => (finish = resolve)) })
    await steps.start(req(shellDef('sleep 1')))
    expect(steps.isLive('run-1', 0)).toBe(true)
    expect(store.runs.steps('run-1')[0].status).toBe('running')
    finish(result())
    await steps.settled()
    expect(steps.isLive('run-1', 0)).toBe(false)
  })

  it('refuses to start, writing nothing itself, when a placeholder has no value', async () => {
    const { store, steps, calls, req } = setup()
    await expect(
      steps.start(req(shellDef('./teardown.sh', { WT: '{worktree.path}' })))
    ).rejects.toThrow('Shell step prune: no value for {worktree.path}')
    expect(store.runs.steps('run-1')).toEqual([])
    expect(calls).toEqual([])
  })

  it("fails its step and rethrows when the workspace can't be resolved", async () => {
    const { store, steps, req } = setup({
      workspace: async () => {
        throw new Error('No worktree for web-platform')
      }
    })
    await expect(steps.start(req(shellDef('./x.sh')))).rejects.toThrow(
      'No worktree for web-platform'
    )
    expect(store.runs.steps('run-1')[0]).toMatchObject({
      status: 'failed',
      error: 'No worktree for web-platform'
    })
  })
})

describe('makeShellSteps, letting go of its home', () => {
  it.each([
    ['after its process ended', async () => result({ code: 0 }), 'done'],
    [
      "when its process couldn't start",
      () => {
        throw new Error('spawn failed')
      },
      'failed'
    ]
  ] as const)(
    'ends the step and logs it when letting go of its home throws %s',
    async (_n, run, status) => {
      const { store, steps, logs, req } = setup({
        run: run as ShellRunner,
        releaseHome: () => {
          throw new Error('store closed')
        }
      })
      await steps.start(req(shellDef('./merge-back.sh'))).catch(() => {})
      await steps.settled()
      expect(store.runs.steps('run-1')[0].status).toBe(status)
      expect(steps.isLive('run-1', 0)).toBe(false)
      expect(logs).toContain("[pilot] run run-1: couldn't release its home: store closed")
    }
  )
})

describe('sweepOrphanShellSteps', () => {
  it('fails a running shell step no live process owns, and nothing else', () => {
    const { store } = setup()
    store.runs.createStep({
      runId: 'run-1',
      idx: 0,
      name: 'prune',
      agent: 'shell',
      skill: null,
      startedAt: 1,
      kind: 'shell'
    })
    store.runs.updateStep('run-1', 0, { status: 'running' })
    store.runs.createStep({
      runId: 'run-1',
      idx: 1,
      name: 'live',
      agent: 'shell',
      skill: null,
      startedAt: 1,
      kind: 'shell'
    })
    store.runs.updateStep('run-1', 1, { status: 'running' })
    store.runs.createStep({
      runId: 'run-1',
      idx: 2,
      name: 'agent',
      agent: 'claude',
      skill: null,
      startedAt: 1
    })
    store.runs.updateStep('run-1', 2, { status: 'running', terminalHandle: 't', paneKey: 'p' })
    sweepOrphanShellSteps(
      store,
      (_runId, idx) => idx === 1,
      () => 9,
      () => {}
    )
    expect(store.runs.steps('run-1').map((s) => s.status)).toEqual(['failed', 'running', 'running'])
    expect(store.runs.steps('run-1')[0].error).toBe(ORPHAN_SHELL_OUTCOME)
  })
})

describe('runShell (a real /bin/sh)', () => {
  it('runs in the folder with the env given, and reports its outputs and exit code', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'pilot-sh-'))
    const outputs = join(dir, 'outputs')
    const r = await runShell({
      command:
        'printf "%s\\n" "$PILOT_RUN_ID"; echo count=2 >> "$PILOT_OUTPUT_FILE"; test -d . && exit 3',
      cwd: dir,
      env: { PATH: '/usr/bin:/bin', PILOT_RUN_ID: 'run-9', PILOT_OUTPUT_FILE: outputs },
      timeoutMs: 10_000
    })
    expect(r).toMatchObject({ code: 3, timedOut: false })
    expect(r.stdout).toContain('run-9')
    expect(outputsFromFile(readFileSync(outputs, 'utf8')).outputs).toEqual({ count: 2 })
  })

  it('stops a command that runs past its timeout', async () => {
    const r = await runShell({
      command: 'sleep 5',
      cwd: tmpdir(),
      env: { PATH: '/usr/bin:/bin' },
      timeoutMs: 500
    })
    expect(r.timedOut).toBe(true)
  })
})

// A timeout stops the step's whole process tree, not just its /bin/sh.
describe('runShell timeouts', () => {
  it("stops a timed-out command's children with it", async () => {
    const result = await runShell({
      command: 'sleep 30 & echo $!; wait',
      cwd: tmpdir(),
      env: { PATH: process.env.PATH ?? '' },
      timeoutMs: 300
    })
    expect(result.timedOut).toBe(true)
    const child = Number(result.stdout.trim())
    expect(child).toBeGreaterThan(0)
    const alive = () => {
      try {
        process.kill(child, 0)
        return true
      } catch {
        return false
      }
    }
    for (let i = 0; i < 40 && alive(); i++) {
      await new Promise((r) => setTimeout(r, 50))
    }
    const stillAlive = alive()
    if (stillAlive) {
      process.kill(child, 'SIGKILL')
    }
    expect(stillAlive).toBe(false)
  })
})
