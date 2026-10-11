import { existsSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
// @ts-expect-error -- .mjs script without type declarations
import { moveAutomation, parseArgs, runCli } from './move-orca-automation.mjs'
// @ts-expect-error -- .mjs script without type declarations
import { mapAutomation, snapshotCopy } from './move-orca-automation-map.mjs'
// @ts-expect-error -- .mjs script without type declarations
import { readRecords, writeRecord } from './move-orca-automation-record.mjs'

type Auto = {
  [key: string]: unknown
  id?: string
  enabled?: boolean
  prompt?: string
  runContext?: Record<string, unknown>
}
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
      projectId: 'git:example/web-platform',
      hostId: 'local',
      projectHostSetupId: 'r1',
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

type FakeOpts = {
  repos?: string[]
  // Calls to break: 'pilot create', 'pilot mismatch', 'pilot enable', 'pilot remove', 'orca disable'.
  fail?: string[]
  // Existing Pilot automations (a half-done move leaves one).
  pilotList?: Auto[]
  // 'orca edit' reports success but changes nothing.
  orcaEditNoEffect?: boolean
  // After the first successful Orca edit, this many `orca show` calls fail.
  orcaReadFailures?: number
  copyOverrides?: Auto
}

// Both CLIs as in-memory fakes that share state, so a retry sees what the first run left.
function fakes(source: Auto, opts: FakeOpts = {}) {
  const calls: string[] = []
  const state = { orcaEnabled: source.enabled as boolean, edited: false, readFailures: 0 }
  const pilotAutos: Auto[] = opts.pilotList ? [...opts.pilotList] : []
  const fail = opts.fail ?? []
  const repos = (opts.repos ?? [REPO]).map((path) => ({ path, displayName: path.split('/').pop() }))
  const orca = (args: string[]): Result => {
    const verb = args[1]
    if (verb === 'show') {
      calls.push('orca show')
      if (args.includes('missing')) {
        return { code: 1, stdout: '', stderr: 'Automation not found' }
      }
      if (state.edited && state.readFailures > 0) {
        state.readFailures -= 1
        return failed
      }
      return ok({ automation: { ...source, enabled: state.orcaEnabled } })
    }
    if (verb === 'edit') {
      calls.push(args.includes('--disabled') ? 'orca disable' : 'orca enable')
      if (fail.includes('orca disable')) {
        return failed
      }
      if (!opts.orcaEditNoEffect) {
        state.orcaEnabled = !args.includes('--disabled')
      }
      state.edited = true
      state.readFailures = opts.orcaReadFailures ?? 0
      return ok({ automation: source })
    }
    throw new Error(`unexpected orca ${args.join(' ')}`)
  }
  const byId = (args: string[]) => pilotAutos.find((auto) => auto.id === args[3])
  const pilot = (args: string[]): Result => {
    const key = args.slice(0, 2).join(' ')
    if (key === 'repo list') {
      return ok({ repos })
    }
    if (key === 'worktree list') {
      return ok({ worktrees: [{ path: REPO }] })
    }
    if (key === 'automations list') {
      return ok({ automations: pilotAutos })
    }
    if (key === 'automations create') {
      calls.push('pilot create')
      if (fail.includes('pilot create')) {
        return failed
      }
      const copy = {
        ...source,
        id: 'pilot-1',
        enabled: !args.includes('--disabled'),
        ...opts.copyOverrides
      }
      if (fail.includes('pilot mismatch')) {
        copy.prompt = 'changed'
      }
      pilotAutos.push(copy)
      return ok({ automation: copy })
    }
    if (key === 'automations show') {
      calls.push('pilot show')
      return ok({ automation: byId(args) })
    }
    if (key === 'automations edit') {
      calls.push('pilot enable')
      if (fail.includes('pilot enable')) {
        return failed
      }
      byId(args)!.enabled = true
      return ok({ automation: byId(args) })
    }
    if (key === 'automations remove') {
      calls.push('pilot remove')
      if (fail.includes('pilot remove')) {
        return failed
      }
      pilotAutos.splice(pilotAutos.indexOf(byId(args)!), 1)
      return ok({ removed: true })
    }
    throw new Error(`unexpected pilot ${args.join(' ')}`)
  }
  return { calls, orca, pilot, state, pilotAutos }
}

function tempRecordFile(): string {
  return join(mkdtempSync(join(tmpdir(), 'pilot-move-')), 'moved-automations.json')
}

function move(f: ReturnType<typeof fakes>, extra: Auto = {}) {
  const lines: string[] = []
  const recordFile = extra.recordFile ?? tempRecordFile()
  const outcome = moveAutomation({
    id: 'orca-1',
    apply: false,
    disableInOrca: false,
    orca: f.orca,
    pilot: f.pilot,
    pilotBin: 'pilot',
    retryDelayMs: 0,
    recordFile,
    now: () => new Date('2026-10-10T12:00:00Z'),
    log: (line: string) => lines.push(line),
    ...extra
  })
  return { outcome, text: lines.join('\n'), recordFile }
}

const APPLY = { apply: true, disableInOrca: true }

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

describe('missedRunGraceMinutes of 0 or null', () => {
  it.each([0, null])('is refused unless --allow-drop names it (%s)', (grace) => {
    const f = fakes(orcaAutomation({ missedRunGraceMinutes: grace }), {
      copyOverrides: { missedRunGraceMinutes: 720 }
    })
    const refused = move(f, APPLY)
    expect(refused.outcome.status).toBe('refused')
    expect(refused.text).toContain('Orca does no catch-up')
    expect(refused.text).toContain('WOULD catch up')
    expect(refused.text).toContain('--allow-drop missedRunGraceMinutes')
    expect(f.calls).toEqual(['orca show'])
  })

  it.each([0, null])(
    'with --allow-drop omits the flag, says so in the plan, and skips verifying it (%s)',
    (grace) => {
      const f = fakes(orcaAutomation({ missedRunGraceMinutes: grace }), {
        copyOverrides: { missedRunGraceMinutes: 720 }
      })
      const dry = move(f, { allowDrop: ['missedRunGraceMinutes'] })
      expect(dry.outcome.mapping.args.some((a: string) => a.includes('grace'))).toBe(false)
      expect(dry.text).toContain("Pilot's default (720, which adds catch-up) applies")
      expect(dry.text).toContain('Fields dropped (allowed): missedRunGraceMinutes')
      expect(move(f, { ...APPLY, allowDrop: ['missedRunGraceMinutes'] }).outcome.status).toBe(
        'applied'
      )
    }
  )

  it('still verifies a positive source value', () => {
    const f = fakes(orcaAutomation(), { copyOverrides: { missedRunGraceMinutes: 60 } })
    const { outcome, text } = move(f, APPLY)
    expect(outcome.status).toBe('failed')
    expect(text).toContain('missedRunGraceMinutes: expected 720')
  })
})

describe('moveAutomation preflight', () => {
  it('refuses, changing nothing, when the target repo is missing from Pilot', () => {
    const f = fakes(orcaAutomation(), { repos: ['/repos/other'] })
    const { outcome, text } = move(f, { apply: true })
    expect(outcome.status).toBe('refused')
    expect(text).toContain("isn't in Pilot")
    expect(f.calls).toEqual(['orca show'])
  })

  it('refuses a field create cannot express unless --allow-drop names it', () => {
    const source = orcaAutomation({ mystery: 1, missedRunPolicy: 'skip' })
    const refused = move(fakes(source))
    expect(refused.outcome.status).toBe('refused')
    expect(refused.text).toContain('--allow-drop mystery')
    expect(refused.text).toContain('--allow-drop missedRunPolicy')
    expect(move(fakes(source), { allowDrop: ['mystery'] }).outcome.status).toBe('refused')
    const allowed = move(fakes(source), { allowDrop: ['mystery', 'missedRunPolicy'] })
    expect(allowed.outcome.status).toBe('dry-run')
    expect(allowed.text).toContain('Fields dropped (allowed): mystery, missedRunPolicy')
  })

  it('a dry run prints the plan and changes nothing, not even the record', () => {
    const f = fakes(orcaAutomation())
    const { outcome, text, recordFile } = move(f, { disableInOrca: true })
    expect(outcome.status).toBe('dry-run')
    expect(text).toContain('then disable it in Orca, then enable it in Pilot')
    expect(f.calls).toEqual(['orca show'])
    expect(f.state.orcaEnabled).toBe(true)
    expect(existsSync(recordFile)).toBe(false)
  })
})

describe('apply', () => {
  it('applies in order: create disabled, verify, disable in Orca, enable in Pilot, and records it', () => {
    const f = fakes(orcaAutomation())
    const { outcome, recordFile } = move(f, APPLY)
    expect(outcome.status).toBe('applied')
    expect(f.calls).toEqual([
      'orca show',
      'pilot create',
      'pilot show',
      'orca disable',
      'orca show',
      'pilot enable',
      'pilot show'
    ])
    expect(f.state.orcaEnabled).toBe(false)
    expect(readRecords(recordFile)['orca-1']).toMatchObject({
      pilotId: 'pilot-1',
      name: '05 · Fix CI',
      movedAt: '2026-10-10T12:00:00.000Z',
      orcaWasEnabled: true,
      state: 'switched',
      verified: true
    })
    expect(readRecords(recordFile)['orca-1'].snapshot.prompt).toBe('do it')
    expect(readdirSync(join(recordFile, '..'))).toEqual(['moved-automations.json'])
  })

  it('without --disable-in-orca leaves Orca alone and Pilot disabled, printing the two commands', () => {
    const f = fakes(orcaAutomation())
    const { outcome, text, recordFile } = move(f, { apply: true })
    expect(outcome.state).toMatchObject({ pilotId: 'pilot-1', pilotEnabled: false })
    expect(f.calls).toEqual(['orca show', 'pilot create', 'pilot show'])
    expect(text).toContain('orca automations edit --id orca-1 --disabled')
    expect(text).toContain('pilot automations edit --id pilot-1 --enabled')
    expect(readRecords(recordFile)['orca-1'].state).toBe('verified')
  })

  it('leaves Pilot disabled when Orca already had the automation disabled', () => {
    const f = fakes(orcaAutomation({ enabled: false }))
    const { outcome } = move(f, APPLY)
    expect(outcome.status).toBe('applied')
    expect(f.calls).toEqual(['orca show', 'pilot create', 'pilot show'])
  })

  it('reports a failed create as nothing created', () => {
    const f = fakes(orcaAutomation(), { fail: ['pilot create'] })
    const { outcome, text } = move(f, APPLY)
    expect(outcome.status).toBe('failed')
    expect(text).toContain('Pilot: nothing created by this run')
  })

  it.each([
    ['executionTargetId', { executionTargetId: 'ssh-1' }],
    [
      'runContext.projectId',
      { runContext: { ...orcaAutomation().runContext, projectId: 'other' } }
    ],
    ['runContext.hostId', { runContext: { ...orcaAutomation().runContext, hostId: 'h2' } }],
    [
      'runContext.projectHostSetupId',
      { runContext: { ...orcaAutomation().runContext, projectHostSetupId: 'zzz' } }
    ]
  ])('fails verification when the copy differs in %s', (field, copyOverrides) => {
    const f = fakes(orcaAutomation(), { copyOverrides })
    const { outcome, text } = move(f, APPLY)
    expect(outcome.status).toBe('failed')
    expect(text).toContain(`${field}: expected`)
    expect(f.calls).toContain('pilot remove')
    expect(f.state.orcaEnabled).toBe(true)
  })
})

describe('apply failures', () => {
  it('removes its own Pilot copy when verification fails, touching nothing in Orca', () => {
    const f = fakes(orcaAutomation(), { fail: ['pilot mismatch'] })
    const { outcome, text, recordFile } = move(f, APPLY)
    expect(outcome.status).toBe('failed')
    expect(f.calls).toEqual(['orca show', 'pilot create', 'pilot show', 'pilot remove'])
    expect(text).toContain('Pilot: nothing created by this run')
    expect(text).toContain('Orca: enabled (verified by read-back)')
    expect(readRecords(recordFile)).toEqual({})
  })

  it('reports the copy as still there when the undo remove itself fails', () => {
    const f = fakes(orcaAutomation(), { fail: ['pilot mismatch', 'pilot remove'] })
    const { outcome, text, recordFile } = move(f, APPLY)
    expect(outcome.status).toBe('failed')
    expect(text).toContain('Could not remove Pilot automation pilot-1 (still there, disabled)')
    expect(text).toContain('Pilot: automation pilot-1 exists, disabled')
    expect(text).not.toContain('Pilot: nothing created')
    expect(readRecords(recordFile)['orca-1'].pilotId).toBe('pilot-1')
  })

  it('removes the Pilot copy when Orca verifiably stays enabled after a failed disable', () => {
    const f = fakes(orcaAutomation(), { fail: ['orca disable'] })
    const { outcome, text } = move(f, APPLY)
    expect(outcome.status).toBe('failed')
    expect(f.calls.at(-1)).toBe('pilot remove')
    expect(text).toContain('Orca: enabled (verified by read-back)')
  })

  it('never enables Pilot when Orca still shows enabled after a "successful" edit', () => {
    const f = fakes(orcaAutomation(), { orcaEditNoEffect: true })
    const { outcome } = move(f, APPLY)
    expect(outcome.status).toBe('failed')
    expect(f.calls).not.toContain('pilot enable')
  })

  it('keeps the Pilot copy and says so when enabling it fails after Orca was disabled', () => {
    const f = fakes(orcaAutomation(), { fail: ['pilot enable'] })
    const { outcome, text } = move(f, APPLY)
    expect(outcome.status).toBe('failed')
    expect(f.calls).not.toContain('pilot remove')
    expect(text).toContain('Orca: disabled (verified by read-back), disabled by this run')
    expect(text).toContain('runs nowhere')
  })
})

describe('an Orca edit that succeeds but cannot be read back', () => {
  it('retries the read and carries on when a later read works', () => {
    const f = fakes(orcaAutomation(), { orcaReadFailures: 2 })
    const { outcome } = move(f, APPLY)
    expect(outcome.status).toBe('applied')
    expect(f.calls.filter((call) => call === 'orca show')).toHaveLength(4)
  })

  it('pauses between read retries, not before the first or after the last', () => {
    const sleeps: number[] = []
    const f = fakes(orcaAutomation(), { orcaReadFailures: 9 })
    move(f, { ...APPLY, retryDelayMs: 25, sleep: (ms: number) => sleeps.push(ms) })
    expect(sleeps).toEqual([25, 25])
  })

  it('reports Orca state unknown, keeps the disabled Pilot copy, and prints the commands', () => {
    const f = fakes(orcaAutomation(), { orcaReadFailures: 9 })
    const { outcome, text, recordFile } = move(f, APPLY)
    expect(outcome.status).toBe('failed')
    expect(f.calls.filter((call) => call === 'orca show')).toHaveLength(4)
    expect(f.calls).not.toContain('pilot remove')
    expect(f.calls).not.toContain('pilot enable')
    expect(f.pilotAutos[0].enabled).toBe(false)
    expect(text).toContain('Orca state unknown')
    expect(text).toContain('orca automations show --id orca-1 --json')
    expect(text).toContain('pilot automations edit --id pilot-1 --enabled')
    expect(text).toContain('Orca: UNKNOWN')
    expect(text).not.toContain('unchanged')
    expect(readRecords(recordFile)['orca-1'].state).toBe('orca-state-unknown')
  })
})

describe('finding the Pilot copy', () => {
  const copy = (overrides: Auto = {}) =>
    orcaAutomation({ id: 'pilot-1', enabled: false, ...overrides })

  it('finds it by the record after either side was renamed', () => {
    const recordFile = tempRecordFile()
    writeRecord(recordFile, 'orca-1', { pilotId: 'pilot-1', name: 'old', state: 'switched' })
    const f = fakes(orcaAutomation({ name: 'renamed in Orca', enabled: false }), {
      pilotList: [copy({ name: 'renamed in Pilot', enabled: true })]
    })
    const { outcome, text } = move(f, { ...APPLY, recordFile })
    expect(outcome).toMatchObject({ status: 'exists', pilotId: 'pilot-1' })
    expect(text).toContain('found by record')
    expect(text).toContain('Already switched')
    expect(f.calls).toEqual(['orca show'])
  })

  it('falls back to name plus target, and does not match the same name on another target', () => {
    const same = move(fakes(orcaAutomation(), { pilotList: [copy()] }))
    expect(same.outcome).toMatchObject({ status: 'exists', pilotId: 'pilot-1' })
    expect(same.text).toContain('found by name and target')
    expect(same.text).toContain('No move record')
    const other = copy({ workspaceId: 'r1::/repos/web-platform-wt' })
    expect(move(fakes(orcaAutomation(), { pilotList: [other] })).outcome.status).toBe('dry-run')
  })

  it('ignores a record whose Pilot copy is gone and creates a new one', () => {
    const recordFile = tempRecordFile()
    writeRecord(recordFile, 'orca-1', { pilotId: 'gone', name: 'x', state: 'switched' })
    const f = fakes(orcaAutomation())
    expect(move(f, { apply: true, recordFile }).outcome.status).toBe('applied')
    expect(readRecords(recordFile)['orca-1'].pilotId).toBe('pilot-1')
  })

  it('a dry run on an existing copy reports both states and changes nothing', () => {
    const f = fakes(orcaAutomation(), { pilotList: [copy()] })
    const { outcome, text } = move(f)
    expect(outcome.status).toBe('exists')
    expect(text).toContain('Pilot disabled, Orca ENABLED')
    expect(f.calls).toEqual(['orca show'])
  })
})

describe('resuming a half-done switch', () => {
  const copy = (enabled: boolean, overrides: Auto = {}) =>
    orcaAutomation({ id: 'pilot-1', enabled, ...overrides })
  // A record as a first run leaves it; `extra` adds verification or other fields.
  const recordFor = (extra: Auto = {}) => {
    const recordFile = tempRecordFile()
    writeRecord(recordFile, 'orca-1', { pilotId: 'pilot-1', state: 'created-disabled', ...extra })
    return recordFile
  }
  const go = (f: ReturnType<typeof fakes>, extra: Auto = {}) =>
    move(f, { ...APPLY, recordFile: recordFor(), ...extra })

  it('Orca enabled, Pilot disabled: disables Orca (verified), then enables Pilot', () => {
    const f = fakes(orcaAutomation(), { pilotList: [copy(false)] })
    expect(go(f).outcome.status).toBe('resumed')
    expect(f.calls).toEqual([
      'orca show',
      'pilot show',
      'orca disable',
      'orca show',
      'pilot enable',
      'pilot show'
    ])
  })

  it('Orca disabled, Pilot disabled: enables Pilot only', () => {
    const f = fakes(orcaAutomation({ enabled: false }), { pilotList: [copy(false)] })
    expect(go(f).outcome.status).toBe('resumed')
    expect(f.calls).toEqual(['orca show', 'pilot show', 'pilot enable', 'pilot show'])
  })

  it('both done: nothing to do', () => {
    const f = fakes(orcaAutomation({ enabled: false }), { pilotList: [copy(true)] })
    const { outcome, text } = go(f)
    expect(outcome.status).toBe('exists')
    expect(text).toContain('Nothing to do')
    expect(f.calls).toEqual(['orca show'])
  })

  it('both enabled: warns and disables Orca, leaving Pilot on', () => {
    const f = fakes(orcaAutomation(), { pilotList: [copy(true)] })
    expect(go(f).text).toContain('both are enabled')
    expect(f.calls).toEqual(['orca show', 'orca disable', 'orca show'])
  })

  it('never enables Pilot while Orca is enabled, and keeps the copy it did not create', () => {
    const f = fakes(orcaAutomation(), { pilotList: [copy(false)], orcaEditNoEffect: true })
    expect(go(f).outcome.status).toBe('failed')
    expect(f.calls).not.toContain('pilot enable')
    expect(f.calls).not.toContain('pilot remove')
  })

  it('does not enable Pilot when the record says Orca was disabled before the move', () => {
    const f = fakes(orcaAutomation({ enabled: false }), { pilotList: [copy(false)] })
    go(f, { recordFile: recordFor({ orcaWasEnabled: false }) })
    expect(f.calls).toEqual(['orca show'])
  })

  it('without --disable-in-orca a retry changes nothing', () => {
    const f = fakes(orcaAutomation(), { pilotList: [copy(false)] })
    expect(go(f, { disableInOrca: false }).outcome.status).toBe('exists')
    expect(f.calls).toEqual(['orca show'])
  })

  it('never enables a copy that failed verification, even after the undo remove failed', () => {
    const recordFile = tempRecordFile()
    const f = fakes(orcaAutomation(), {
      fail: ['pilot mismatch', 'pilot remove']
    })
    expect(move(f, { ...APPLY, recordFile }).outcome.status).toBe('failed')
    expect(readRecords(recordFile)['orca-1']).toMatchObject({ verified: false, snapshot: null })
    const retry = move(f, { ...APPLY, recordFile })
    expect(retry.outcome.status).toBe('refused')
    expect(retry.text).toContain('prompt: expected')
    expect(f.calls).not.toContain('pilot enable')
    expect(f.pilotAutos[0].enabled).toBe(false)
  })

  it('leaves an unverified copy off when Orca was disabled from the start', () => {
    const recordFile = tempRecordFile()
    const f = fakes(orcaAutomation({ enabled: false }), {
      fail: ['pilot mismatch', 'pilot remove']
    })
    move(f, { ...APPLY, recordFile })
    move(f, { ...APPLY, recordFile })
    expect(f.calls).not.toContain('pilot enable')
    expect(f.pilotAutos[0].enabled).toBe(false)
  })

  it('refuses an unverified copy before touching Orca', () => {
    const f = fakes(orcaAutomation(), { pilotList: [copy(false, { prompt: 'edited' })] })
    const { outcome, text } = go(f)
    expect(outcome.status).toBe('refused')
    expect(text).toContain('has not passed verification')
    expect(text).toContain('pilot automations edit --id pilot-1 --enabled')
    expect(f.calls).toEqual(['orca show', 'pilot show'])
    expect(f.state.orcaEnabled).toBe(true)
  })

  it('enables a copy whose record says verified and which still matches its snapshot', () => {
    const verified = copy(false, { prompt: 'verified earlier' })
    const recordFile = recordFor({ verified: true, snapshot: snapshotCopy(verified) })
    const f = fakes(orcaAutomation(), { pilotList: [verified] })
    expect(move(f, { ...APPLY, recordFile }).outcome.status).toBe('resumed')
    expect(f.pilotAutos[0].enabled).toBe(true)
  })

  it('refuses a verified copy that has drifted from its snapshot and no longer matches Orca', () => {
    const recordFile = recordFor({ verified: true, snapshot: snapshotCopy(copy(false)) })
    const f = fakes(orcaAutomation(), { pilotList: [copy(false, { prompt: 'drifted' })] })
    const { outcome, text } = move(f, { ...APPLY, recordFile })
    expect(outcome.status).toBe('refused')
    expect(text).toContain('drift since verification: prompt')
    expect(f.calls).not.toContain('pilot enable')
  })

  it('enables a clean copy even when its record never reached verified', () => {
    const f = fakes(orcaAutomation({ enabled: false }), { pilotList: [copy(false)] })
    expect(go(f).outcome.status).toBe('resumed')
  })
})

describe('a copy matched by name and target with no record', () => {
  const handMade = () => orcaAutomation({ id: 'pilot-9', enabled: false })

  it('is never switched on, and the commands are printed', () => {
    const f = fakes(orcaAutomation({ enabled: false }), { pilotList: [handMade()] })
    const { outcome, text } = move(f, APPLY)
    expect(outcome.status).toBe('exists')
    expect(text).toContain('--adopt')
    expect(text).toContain('pilot automations edit --id pilot-9 --enabled')
    expect(f.calls).toEqual(['orca show'])
  })

  it('with --adopt is verified, recorded, then switched', () => {
    const f = fakes(orcaAutomation(), { pilotList: [handMade()] })
    const { outcome, recordFile } = move(f, { ...APPLY, adopt: true })
    expect(outcome.status).toBe('resumed')
    expect(f.pilotAutos[0].enabled).toBe(true)
    expect(f.state.orcaEnabled).toBe(false)
    expect(readRecords(recordFile)['orca-1']).toMatchObject({
      pilotId: 'pilot-9',
      verified: true,
      state: 'switched'
    })
  })

  it('with --adopt is refused, changing nothing, when it does not verify', () => {
    const bad = orcaAutomation({ id: 'pilot-9', enabled: false, prompt: 'hand-made' })
    const f = fakes(orcaAutomation(), { pilotList: [bad] })
    const { outcome, recordFile } = move(f, { ...APPLY, adopt: true })
    expect(outcome.status).toBe('refused')
    expect(f.calls).toEqual(['orca show', 'pilot show'])
    expect(existsSync(recordFile)).toBe(false)
  })
})

describe('one definition of enabled', () => {
  it.each([undefined, null, 'yes'])('treats Orca enabled=%s as disabled', (value) => {
    const f = fakes(orcaAutomation({ enabled: value }))
    const { text } = move(f, APPLY)
    expect(text).toContain('disabled in Orca')
    expect(f.calls).toEqual(['orca show', 'pilot create', 'pilot show'])
  })
})

describe('the move record', () => {
  it('is written atomically as JSON in the injected folder', () => {
    const file = tempRecordFile()
    writeRecord(file, 'a', { pilotId: 'p', name: 'n', movedAt: 't', state: 's' })
    writeRecord(file, 'b', { pilotId: 'q', name: 'm', movedAt: 't', state: 's' })
    expect(Object.keys(JSON.parse(readFileSync(file, 'utf8')))).toEqual(['a', 'b'])
    expect(readdirSync(join(file, '..'))).toEqual(['moved-automations.json'])
  })

  it('refuses a corrupt file rather than overwriting it, and Orca folders outright', () => {
    const file = tempRecordFile()
    writeFileSync(file, '{nope')
    expect(() => writeRecord(file, 'a', {})).toThrow("isn't a valid move record")
    expect(readFileSync(file, 'utf8')).toBe('{nope')
    const inOrca = join(homedir(), 'Library', 'Application Support', 'orca', 'x.json')
    expect(() => writeRecord(inOrca, 'a', {})).toThrow("Orca's data folder")
  })
})

describe('runCli', () => {
  it('exits 1 with a clear message when Orca has no such automation', () => {
    const f = fakes(orcaAutomation())
    const out: string[] = []
    const code = runCli(
      ['--id', 'missing', '--record-file', tempRecordFile()],
      (line: string) => out.push(line),
      () => {},
      { orca: f.orca, pilot: f.pilot }
    )
    expect(code).toBe(1)
    expect(out.join('\n')).toContain('not found in Orca')
  })

  it('requires --id', () => {
    expect(() => parseArgs([])).toThrow('--id')
  })
})
