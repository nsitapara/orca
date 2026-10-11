import { describe, expect, it } from 'vitest'
// @ts-expect-error -- .mjs script without type declarations
import { moveAutomation, parseArgs, runCli } from './move-orca-automation.mjs'
// @ts-expect-error -- .mjs script without type declarations
import { mapAutomation } from './move-orca-automation-map.mjs'

type Auto = Record<string, unknown>
type Result = { code: number; stdout: string; stderr: string }

const REPO = '/repos/web-platform'

function orcaAutomation(overrides: Auto = {}): Auto {
  return {
    id: 'orca-1',
    name: '05 · Fix CI',
    prompt: 'do it',
    precheck: { command: 'exit 1', timeoutSeconds: 600 },
    agentId: 'claude',
    runContext: {
      kind: 'workspace-run',
      hostId: 'local',
      repoId: 'r1',
      path: REPO
    },
    sourceContext: null,
    projectId: 'r1',
    executionTargetType: 'local',
    executionTargetId: 'local',
    schedulerOwner: 'local_host_service',
    workspaceMode: 'existing',
    workspaceId: `r1::${REPO}`,
    baseBranch: null,
    reuseSession: true,
    timezone: 'America/Los_Angeles',
    rrule: '10 * * * *',
    dtstart: 1,
    enabled: true,
    nextRunAt: 2,
    missedRunPolicy: 'run_once_within_grace',
    missedRunGraceMinutes: 720,
    createdAt: 1,
    updatedAt: 1,
    lastRunAt: 1,
    ...overrides
  }
}

const ok = (result: unknown): Result => ({
  code: 0,
  stdout: JSON.stringify({ ok: true, result }),
  stderr: ''
})
const failed: Result = { code: 1, stdout: '', stderr: 'boom' }

type Fakes = {
  calls: string[]
  orca: (args: string[]) => Result
  pilot: (args: string[]) => Result
  orcaEnabled: () => boolean
  pilotList: Auto[]
}

// Both CLIs as in-memory fakes. `fail` names calls ("pilot enable", "orca disable", ...) to break.
function fakes(
  source: Auto,
  opts: { repos?: string[]; fail?: string[]; pilotList?: Auto[] } = {}
): Fakes {
  const calls: string[] = []
  let orcaEnabled = source.enabled as boolean
  let copy: Auto | null = null
  const fail = opts.fail ?? []
  const repos = (opts.repos ?? [REPO]).map((path) => ({
    path,
    displayName: path.split('/').pop()
  }))
  const orca = (args: string[]): Result => {
    const verb = args[1]
    calls.push(`orca ${verb}${args.includes('--disabled') ? ' --disabled' : ''}`)
    if (verb === 'show') {
      return args.includes('missing')
        ? { code: 1, stdout: '', stderr: 'Automation not found' }
        : ok({ automation: { ...source, enabled: orcaEnabled } })
    }
    if (verb === 'edit') {
      if (fail.includes('orca disable')) {
        return failed
      }
      orcaEnabled = false
      return ok({ automation: source })
    }
    throw new Error(`unexpected orca ${args.join(' ')}`)
  }
  const pilotList = opts.pilotList ?? []
  const pilot = (args: string[]): Result => {
    const key = args.slice(0, 2).join(' ')
    if (key === 'repo list') {
      return ok({ repos })
    }
    if (key === 'worktree list') {
      return ok({ worktrees: [{ path: REPO }] })
    }
    if (key === 'automations list') {
      return ok({ automations: pilotList })
    }
    if (key === 'automations create') {
      calls.push('pilot create')
      if (fail.includes('pilot create')) {
        return failed
      }
      copy = {
        ...source,
        id: 'pilot-1',
        enabled: !args.includes('--disabled')
      }
      if (fail.includes('pilot mismatch')) {
        copy.prompt = 'changed'
      }
      return ok({ automation: copy })
    }
    if (key === 'automations show') {
      calls.push('pilot show')
      return ok({ automation: copy })
    }
    if (key === 'automations edit') {
      calls.push('pilot enable')
      if (fail.includes('pilot enable')) {
        return failed
      }
      copy = { ...copy, enabled: true }
      return ok({ automation: copy })
    }
    if (key === 'automations remove') {
      calls.push('pilot remove')
      copy = null
      return ok({ removed: true })
    }
    throw new Error(`unexpected pilot ${args.join(' ')}`)
  }
  return { calls, orca, pilot, orcaEnabled: () => orcaEnabled, pilotList }
}

function move(f: Fakes, extra: Auto = {}) {
  const lines: string[] = []
  const outcome = moveAutomation({
    id: 'orca-1',
    apply: false,
    disableInOrca: false,
    orca: f.orca,
    pilot: f.pilot,
    pilotBin: 'pilot',
    log: (line: string) => lines.push(line),
    ...extra
  })
  return { outcome, text: lines.join('\n') }
}

describe('mapAutomation', () => {
  it('maps every create flag from an existing-workspace automation, created disabled', () => {
    const { args } = mapAutomation(orcaAutomation({ extraAgentArgs: '--model opus' }))
    expect(args).toEqual([
      'automations',
      'create',
      '--name=05 · Fix CI',
      '--prompt=do it',
      '--trigger=10 * * * *',
      '--provider=claude',
      '--timezone=America/Los_Angeles',
      '--extra-agent-args=--model opus',
      '--precheck=exit 1',
      '--precheck-timeout=600',
      `--workspace=path:${REPO}`,
      '--workspace-mode=existing',
      '--reuse-session',
      '--missed-run-grace-minutes=720',
      '--disabled',
      '--json'
    ])
  })

  it('maps a new-per-run automation to --repo, --base-branch and --fresh-session', () => {
    const { args } = mapAutomation(
      orcaAutomation({
        workspaceMode: 'new_per_run',
        workspaceId: null,
        baseBranch: 'origin/dev',
        reuseSession: false,
        precheck: null
      })
    )
    expect(args).toEqual(
      expect.arrayContaining([
        `--repo=path:${REPO}`,
        '--workspace-mode=new-per-run',
        '--base-branch=origin/dev',
        '--fresh-session'
      ])
    )
    expect(args.some((arg: string) => arg.startsWith('--precheck'))).toBe(false)
  })
})

describe('moveAutomation', () => {
  it('refuses, changing nothing, when the target repo is missing from Pilot', () => {
    const f = fakes(orcaAutomation(), { repos: ['/repos/other'] })
    const { outcome, text } = move(f, { apply: true })
    expect(outcome.status).toBe('refused')
    expect(outcome.exitCode).toBe(1)
    expect(text).toContain("isn't in Pilot")
    expect(f.calls).toEqual(['orca show'])
  })

  it('refuses a field create cannot express unless --allow-drop names it', () => {
    const source = orcaAutomation({ mystery: 1, missedRunPolicy: 'skip' })
    const refused = move(fakes(source))
    expect(refused.outcome.status).toBe('refused')
    expect(refused.text).toContain('--allow-drop mystery')
    expect(refused.text).toContain('--allow-drop missedRunPolicy')

    const partly = move(fakes(source), { allowDrop: ['mystery'] })
    expect(partly.outcome.status).toBe('refused')

    const allowed = move(fakes(source), {
      allowDrop: ['mystery', 'missedRunPolicy']
    })
    expect(allowed.outcome.status).toBe('dry-run')
    expect(allowed.text).toContain('Fields dropped (allowed): mystery, missedRunPolicy')
  })

  it('reports an existing Pilot automation with the same name and target and creates nothing', () => {
    const f = fakes(orcaAutomation(), {
      pilotList: [orcaAutomation({ id: 'pilot-9', enabled: false })]
    })
    const { outcome, text } = move(f, { apply: true, disableInOrca: true })
    expect(outcome).toMatchObject({
      status: 'exists',
      exitCode: 0,
      pilotId: 'pilot-9'
    })
    expect(text).toContain('already has')
    expect(f.calls).toEqual(['orca show'])
  })

  it('does not treat the same name on another target as a duplicate', () => {
    const other = orcaAutomation({
      id: 'pilot-9',
      workspaceId: 'r1::/repos/web-platform-wt'
    })
    const { outcome } = move(fakes(orcaAutomation(), { pilotList: [other] }))
    expect(outcome.status).toBe('dry-run')
  })

  it('a dry run prints the plan and changes nothing, even with --disable-in-orca', () => {
    const f = fakes(orcaAutomation())
    const { outcome, text } = move(f, { disableInOrca: true })
    expect(outcome.status).toBe('dry-run')
    expect(text).toContain('pilot automations create')
    expect(text).toContain('then disable it in Orca, then enable it in Pilot')
    expect(f.calls).toEqual(['orca show'])
    expect(f.orcaEnabled()).toBe(true)
  })

  it('applies in order: create disabled, verify, disable in Orca, enable in Pilot', () => {
    const f = fakes(orcaAutomation())
    const { outcome } = move(f, { apply: true, disableInOrca: true })
    expect(outcome.status).toBe('applied')
    expect(f.calls).toEqual([
      'orca show',
      'pilot create',
      'pilot show',
      'orca edit --disabled',
      'orca show',
      'pilot enable',
      'pilot show'
    ])
    expect(f.orcaEnabled()).toBe(false)
  })

  it('without --disable-in-orca leaves Orca alone and Pilot disabled, printing the two commands', () => {
    const f = fakes(orcaAutomation())
    const { outcome, text } = move(f, { apply: true })
    expect(outcome.state).toMatchObject({
      pilotId: 'pilot-1',
      pilotEnabled: false,
      orcaDisabled: false
    })
    expect(f.calls).toEqual(['orca show', 'pilot create', 'pilot show'])
    expect(text).toContain('orca automations edit --id orca-1 --disabled')
    expect(text).toContain('pilot automations edit --id pilot-1 --enabled')
  })

  it('removes its own Pilot copy when verification fails, touching nothing in Orca', () => {
    const f = fakes(orcaAutomation(), { fail: ['pilot mismatch'] })
    const { outcome, text } = move(f, { apply: true, disableInOrca: true })
    expect(outcome.status).toBe('failed')
    expect(f.calls).toEqual(['orca show', 'pilot create', 'pilot show', 'pilot remove'])
    expect(text).toContain('prompt: expected')
    expect(text).toContain('Pilot: nothing created by this run')
    expect(f.orcaEnabled()).toBe(true)
  })

  it('removes the Pilot copy when disabling Orca fails, and reports Orca unchanged', () => {
    const f = fakes(orcaAutomation(), { fail: ['orca disable'] })
    const { outcome, text } = move(f, { apply: true, disableInOrca: true })
    expect(outcome.status).toBe('failed')
    expect(f.calls.at(-1)).toBe('pilot remove')
    expect(text).toContain('Orca: unchanged by this run')
  })

  it('keeps the Pilot copy and says so when enabling it fails after Orca was disabled', () => {
    const f = fakes(orcaAutomation(), { fail: ['pilot enable'] })
    const { outcome, text } = move(f, { apply: true, disableInOrca: true })
    expect(outcome.status).toBe('failed')
    expect(f.calls).not.toContain('pilot remove')
    expect(text).toContain('Pilot: automation pilot-1 exists, disabled')
    expect(text).toContain('Orca: disabled by this run')
    expect(text).toContain('runs nowhere')
  })

  it('reports a failed create as nothing created', () => {
    const f = fakes(orcaAutomation(), { fail: ['pilot create'] })
    const { outcome, text } = move(f, { apply: true })
    expect(outcome.status).toBe('failed')
    expect(text).toContain('Pilot: nothing created by this run')
  })

  it('leaves Pilot disabled when Orca already has the automation disabled', () => {
    const f = fakes(orcaAutomation({ enabled: false }))
    const { outcome } = move(f, { apply: true, disableInOrca: true })
    expect(outcome.status).toBe('applied')
    expect(f.calls).toEqual(['orca show', 'pilot create', 'pilot show'])
  })
})

describe('runCli', () => {
  it('exits 1 with a clear message when Orca has no such automation', () => {
    const f = fakes(orcaAutomation())
    const out: string[] = []
    const code = runCli(
      ['--id', 'missing'],
      (line: string) => out.push(line),
      () => {},
      {
        orca: f.orca,
        pilot: f.pilot
      }
    )
    expect(code).toBe(1)
    expect(out.join('\n')).toContain('not found in Orca')
  })

  it('requires --id', () => {
    expect(() => parseArgs([])).toThrow('--id')
  })
})
