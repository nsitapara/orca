import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import type { RpcCallerIdentity } from '../../../../../main/runtime/rpc/rpc-caller-identity'
import { denyRpcMethodForCaller } from '../../../../../main/runtime/rpc/rpc-caller-scope'
import type { RpcMethodPermission } from '../../../../../main/runtime/rpc/rpc-method-permission'
import type { PilotStatus } from '../../shared/api-types'
import { loadDefinitions } from '../definitions/loader'
import type { PilotHost } from '../pilot-services'
import { PilotStore } from '../store/store'
import { AGENT_IN_RUN, buildPilotMethods, NO_CALLER_CHANGE } from './methods'
import { SCHEDULER_OFF } from '../scheduler/scheduler'

// Desktop/serve Pilot inside Electron: Orca's own engine is off there.
vi.mock('../orca-automations-off', () => ({
  isOrcaAutomationsOff: () => true
}))

type Callable = {
  name: string
  permission: RpcMethodPermission
  params: { safeParse(v: unknown): { success: boolean } } | null
  handler(p: unknown, rpc?: { caller?: RpcCallerIdentity }): unknown
}

const DESKTOP = { caller: { kind: 'desktop' } as RpcCallerIdentity }

function setup(over: Partial<PilotHost> = {}, scheduler: unknown = null, schedulerOn = true) {
  return setupWithStore(over, scheduler, schedulerOn).find
}

function setupWithStore(
  over: Partial<PilotHost> = {},
  scheduler: unknown = null,
  schedulerOn = true
) {
  const dir = mkdtempSync(join(tmpdir(), 'pilot-methods-'))
  writeFileSync(
    join(dir, 'ci.yaml'),
    'name: X\nrepo: r\nschedule: manual\nitems: { kind: merge_request }\nsteps: [ { agent: claude, prompt: x } ]\n'
  )
  const loaded = loadDefinitions([dir])
  let current = loaded
  const store = PilotStore.open(join(dir, 'db.sqlite'))
  const host: PilotHost = {
    processKind: 'main',
    dirs: [dir],
    dataDir: dir,
    error: null,
    context: {
      processKind: 'main',
      store,
      dirs: [dir],
      loaded: () => current,
      reload: () => {
        current = loadDefinitions([dir])
        return current
      },
      scheduler: scheduler as never,
      actions: { entries: () => [], get: () => null },
      dispatcher: null,
      schedulerOn
    },
    ...over
  }
  const methods = buildPilotMethods(host) as unknown as Callable[]
  return {
    find: (name: string) => methods.find((m) => m.name === name)!,
    methods,
    store,
    dir
  }
}

describe('Pilot RPC methods', () => {
  it('says which machine it is and whether it runs the scheduler, in pilot.status', () => {
    const on = setup({ machineName: () => 'Mac mini' })('pilot.status').handler(null)
    expect(on).toMatchObject({ machineName: 'Mac mini', schedulerOn: true })
    const off = setup({}, null, false)('pilot.status').handler(null)
    expect(off).toMatchObject({ schedulerOn: false })
    const failed = setup({ context: null, error: 'boom' })('pilot.status').handler(null)
    expect(failed).toMatchObject({ schedulerOn: false })
  })

  it('lets a paired web client call every Pilot method', () => {
    const { methods } = setupWithStore()
    const refused = methods.flatMap((m) => {
      const why = denyRpcMethodForCaller(
        { kind: 'runtime-paired', grants: [] },
        m.name,
        m.permission
      )
      return why ? [`${m.name}: ${why}`] : []
    })
    expect(methods.length).toBeGreaterThan(40)
    expect(refused).toEqual([])
  })

  it('registers every method as pilot.* with a workspace permission', () => {
    const find = setup()
    const names = [
      'pilot.status',
      'pilot.automations.list',
      'pilot.automations.get',
      'pilot.automations.activity',
      'pilot.automations.dryRun',
      'pilot.automations.tickNow',
      'pilot.automations.reload',
      'pilot.automations.validate',
      'pilot.automations.setEnabled',
      'pilot.run.output',
      'pilot.run.event',
      'pilot.activity.list',
      'pilot.runs.get',
      'pilot.runs.log',
      'pilot.runs.logEntry',
      'pilot.runs.effects',
      'pilot.runs.doneForYou',
      'pilot.runs.acknowledge'
    ]
    for (const n of names) {
      expect(find(n)).toMatchObject({
        name: n,
        permission: 'workspace',
        pilot: true
      })
    }
  })

  it('reports the scheduler loop times in pilot.status, null without a scheduler', () => {
    const times = { loopStartedAt: 10, lastLoopFinishedAt: 20 }
    const status = setup(
      {},
      { loopTimes: () => times }
    )('pilot.status').handler(null) as PilotStatus
    expect(status).toMatchObject(times)
    const none = setup({ context: null, error: 'boom' })('pilot.status').handler(
      null
    ) as PilotStatus
    expect(none).toMatchObject({
      loopStartedAt: null,
      lastLoopFinishedAt: null,
      error: 'boom'
    })
  })

  it.each([
    { processKind: 'main' as const, expected: true },
    { processKind: 'orcad' as const, expected: false }
  ])(
    "pilot.status says Orca's engine is off only where the hook stops it: $processKind → $expected",
    ({ processKind, expected }) => {
      const status = setup({ processKind })('pilot.status').handler(null) as PilotStatus
      expect(status.orcaAutomationsOff).toBe(expected)
    }
  )

  it("makes every automations method say Pilot isn't running when it failed to start", async () => {
    const find = setup({ context: null, error: 'file is not a database' })
    const names = [
      'list',
      'get',
      'activity',
      'dryRun',
      'tickNow',
      'reload',
      'validate',
      'setEnabled'
    ]
    for (const n of names) {
      await expect(
        Promise.resolve().then(() =>
          find(`pilot.automations.${n}`).handler({ id: 'ci', yaml: 'x' })
        )
      ).rejects.toThrow("Pilot isn't running: file is not a database")
    }
    for (const name of ['pilot.run.output', 'pilot.run.event']) {
      await expect(
        Promise.resolve().then(() =>
          find(name).handler({
            runId: 'r',
            stepIdx: 0,
            outputs: { a: 1 },
            kind: 'x'
          })
        )
      ).rejects.toThrow("Pilot isn't running: file is not a database")
    }
  })

  it('checks run.output names and values, and caps an event payload at 64 KB', () => {
    const find = setup()
    const output = find('pilot.run.output').params!
    expect(
      output.safeParse({
        runId: 'r',
        stepIdx: 0,
        outputs: { changed: true, n: 2, s: 'x', z: null }
      }).success
    ).toBe(true)
    expect(output.safeParse({ terminal: 't', outputs: { a: 1 } }).success).toBe(true)
    expect(output.safeParse({ runId: 'r', stepIdx: 0, outputs: { 'bad-key': 1 } }).success).toBe(
      false
    )
    expect(output.safeParse({ runId: 'r', stepIdx: 0, outputs: {} }).success).toBe(false)
    expect(output.safeParse({ runId: 'r', stepIdx: -1, outputs: { a: 1 } }).success).toBe(false)
    const event = find('pilot.run.event').params!
    expect(event.safeParse({ runId: 'r', kind: 'pushed', payload: { sha: 'abc' } }).success).toBe(
      true
    )
    expect(event.safeParse({ terminal: 't', kind: 'pushed' }).success).toBe(true)
    expect(event.safeParse({ runId: 'r', kind: 'Pushed!' }).success).toBe(false)
    expect(
      event.safeParse({
        runId: 'r',
        kind: 'big',
        payload: { x: 'y'.repeat(64 * 1024) }
      }).success
    ).toBe(false)
  })

  it('caps validate input at 256 KB and activity limit at 200', () => {
    const find = setup()
    const validate = find('pilot.automations.validate').params!
    expect(validate.safeParse({ yaml: 'x'.repeat(256 * 1024) }).success).toBe(true)
    expect(validate.safeParse({ yaml: 'x'.repeat(256 * 1024 + 1) }).success).toBe(false)
    const act = find('pilot.automations.activity').params!
    expect(act.safeParse({ id: 'ci', limit: 200 }).success).toBe(true)
    expect(act.safeParse({ id: 'ci', limit: 201 }).success).toBe(false)
    expect(act.safeParse({ id: 'ci', skipQuiet: true }).success).toBe(true)
    expect(act.safeParse({ id: 'ci', skipQuiet: 'yes' }).success).toBe(false)
  })

  it('passes the scheduler result of dryRun and tickNow through unchanged', async () => {
    const calls: unknown[] = []
    const scheduler = {
      tickNow: async (id: string, o: unknown) => {
        calls.push([id, o])
        return { status: 'busy' }
      }
    }
    const find = setup({}, scheduler)
    expect(await find('pilot.automations.dryRun').handler({ id: 'ci' })).toEqual({ status: 'busy' })
    expect(await find('pilot.automations.tickNow').handler({ id: 'ci' }, DESKTOP)).toEqual({
      status: 'busy'
    })
    expect(calls).toEqual([
      ['ci', { dryRun: true }],
      ['ci', { dryRun: false, byHand: true }]
    ])
    await expect(
      find('pilot.automations.tickNow').handler({ id: 'nope' }, DESKTOP)
    ).rejects.toThrow('No automation "nope"')
  })
})

// An agent reaches Pilot as the local CLI with its step's terminal (bindingFromEnv); Nish's own CLI has no
// step on its terminal. Only callers that aren't an agent in a run may tick or flip an automation.
describe('who may tick, enable or pause an automation', () => {
  const LOCAL = { kind: 'local-cli' } as RpcCallerIdentity
  const PHONE = {
    kind: 'paired-device',
    deviceId: 'ipad'
  } as RpcCallerIdentity

  // ci.yaml with an agent's step running on term-agent (run-1, step 0).
  function agentSetup() {
    const ticks: unknown[] = []
    const scheduler = {
      tickNow: async (id: string, o: unknown) => {
        ticks.push([id, o])
        return { status: 'busy' }
      },
      nextTickAt: () => null
    }
    const { find, store, dir } = setupWithStore({}, scheduler)
    store.runs.create({
      id: 'run-1',
      automationId: 'ci',
      tickId: null,
      itemKey: 'mr:1',
      itemLabel: '!1',
      worktreePath: '/wt',
      startedAt: 1
    })
    store.runs.createStep({
      runId: 'run-1',
      idx: 0,
      name: 's',
      agent: 'claude',
      skill: null,
      mode: null,
      startedAt: 1
    })
    store.runs.updateStep('run-1', 0, {
      status: 'running',
      terminalHandle: 'term-agent'
    })
    return { find, ticks, store, file: join(dir, 'ci.yaml') }
  }

  it.each([
    ['the desktop', DESKTOP.caller, {}, true],
    ['a paired device', PHONE, {}, true],
    ["Nish's CLI in a terminal no step runs on", LOCAL, { terminal: 'term-nish' }, true],
    ['the CLI with no terminal at all', LOCAL, {}, true],
    ['an agent on its step terminal', LOCAL, { terminal: 'term-agent' }, false],
    ['an agent naming its run by env only', LOCAL, { runId: 'run-1', stepIdx: 0 }, false],
    ['an env naming a run that ended', LOCAL, { runId: 'gone', stepIdx: 0 }, false],
    ['no identity', undefined, {}, false]
  ])('tickNow from %s', async (_name, caller, binding, allowed) => {
    const { find, ticks } = agentSetup()
    const call = () =>
      find('pilot.automations.tickNow').handler({ id: 'ci', ...binding }, { caller })
    if (allowed) {
      expect(await call()).toEqual({ status: 'busy' })
      expect(ticks).toEqual([['ci', { dryRun: false, byHand: true }]])
    } else {
      await expect(Promise.resolve().then(call)).rejects.toThrow(
        caller ? AGENT_IN_RUN : NO_CALLER_CHANGE
      )
      expect(ticks).toEqual([])
    }
  })

  it.each([
    ['the desktop', DESKTOP.caller, {}, true],
    ['a paired device', PHONE, {}, true],
    ["Nish's unbound CLI", LOCAL, { terminal: 'term-nish' }, true],
    ['an agent on its step terminal', LOCAL, { terminal: 'term-agent' }, false],
    ['an agent naming its run by env only', LOCAL, { runId: 'run-1', stepIdx: 0 }, false],
    ['no identity', undefined, {}, false]
  ])('setEnabled from %s', async (_name, caller, binding, allowed) => {
    const { find, file } = agentSetup()
    const call = () =>
      find('pilot.automations.setEnabled').handler(
        { id: 'ci', enabled: false, ...binding },
        { caller }
      )
    if (allowed) {
      expect(call()).toMatchObject({ id: 'ci', enabled: false })
      expect(readFileSync(file, 'utf8')).toContain('enabled: false')
    } else {
      expect(call).toThrow(caller ? AGENT_IN_RUN : NO_CALLER_CHANGE)
      expect(readFileSync(file, 'utf8')).not.toContain('enabled:')
    }
  })

  it("refuses a real tick where the scheduler doesn't run, and still dry-runs there", async () => {
    const ticks: unknown[] = []
    const scheduler = {
      tickNow: async (id: string, o: unknown) => {
        ticks.push([id, o])
        return { status: 'busy' }
      }
    }
    const find = setup({}, scheduler, false)
    await expect(
      Promise.resolve().then(() => find('pilot.automations.tickNow').handler({ id: 'ci' }, DESKTOP))
    ).rejects.toThrow(SCHEDULER_OFF)
    expect(await find('pilot.automations.dryRun').handler({ id: 'ci' }, DESKTOP)).toEqual({
      status: 'busy'
    })
    expect(ticks).toEqual([['ci', { dryRun: true }]])
  })
})
