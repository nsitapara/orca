import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import type { RpcCallerIdentity } from '../../../../../main/runtime/rpc/rpc-caller-identity'
import type { ActionEntry } from '../actions/types'
import { loadDefinitions } from '../definitions/loader'
import type { PilotHost } from '../pilot-services'
import { PilotStore } from '../store/store'
import { buildPilotMethods } from './methods'

type Callable = {
  name: string
  params: { safeParse(v: unknown): { success: boolean } } | null
  handler(p: unknown, ctx: { caller?: RpcCallerIdentity }): unknown
}

const LOCAL: RpcCallerIdentity = { kind: 'local-cli' }

const CI =
  'name: Fix CI\nrepo: r\nschedule: manual\nitems: { kind: merge_request }\nsteps: [ { agent: claude, prompt: x } ]\ninbox: nish\n'

function setup(powers = '') {
  const dir = mkdtempSync(join(tmpdir(), 'pilot-actions-rpc-'))
  writeFileSync(join(dir, 'people.yaml'), 'people:\n  - { id: nish, name: Nish }\n')
  writeFileSync(join(dir, 'ci.yaml'), CI)
  writeFileSync(
    join(dir, 'rel.yaml'),
    CI.replace('Fix CI', 'Release').replace('inbox:', `powers: [${powers}]\ninbox:`)
  )
  const loaded = loadDefinitions([dir])
  const store = PilotStore.open(join(dir, 'db.sqlite'))
  for (const [id, automationId] of [
    ['run-1', 'ci'],
    ['run-2', 'rel']
  ]) {
    store.runs.create({
      id,
      automationId,
      tickId: null,
      itemKey: 'mr:1',
      itemLabel: '!1',
      worktreePath: '/wt',
      startedAt: 1
    })
    store.runs.createStep({
      runId: id,
      idx: 0,
      name: 's',
      agent: 'claude',
      skill: null,
      mode: null,
      startedAt: 1
    })
  }
  const push = {
    name: 'push',
    power: 'push',
    label: 'Push',
    usage: 'push …',
    checkArgs: (args) => (Array.isArray(args.argv) ? null : 'usage: push …'),
    describe: async () => 'Push b',
    run: vi
      .fn()
      .mockResolvedValue({ outcome: 'done', detail: 'pushed', link: null, log: null, onYou: false })
  } as ActionEntry
  const actions = { entries: () => [push], get: (n: string) => (n === 'push' ? push : null) }
  const host: PilotHost = {
    processKind: 'main',
    dirs: [dir],
    dataDir: dir,
    error: null,
    context: {
      processKind: 'main',
      store,
      dirs: [dir],
      loaded: () => loaded,
      reload: () => loaded,
      scheduler: null as never,
      actions
    }
  }
  const methods = buildPilotMethods(host) as unknown as Callable[]
  const find = (name: string) => methods.find((m) => m.name === name)!
  // The transport stamps who is calling (rpc-caller-identity.ts); agents reach Pilot as the local CLI.
  const call = (
    name: string,
    p: unknown,
    ctx: { caller?: RpcCallerIdentity } = { caller: LOCAL }
  ) => find(name).handler(p, ctx)
  return { store, push, find, call }
}

const PUSH = { action: 'push', args: { argv: ['a'] } }

describe('action RPC', () => {
  it.each([
    [{ action: 'push', args: { argv: ['a'] } }, true],
    [{ action: 'push', args: ['a'] }, false],
    [{ action: '', args: {} }, false],
    [{ action: 'linear_comment', args: { issue: 'WEB-1', body: 'x'.repeat(64 * 1024) } }, false]
  ])('checks run params %#', (params, ok) => {
    const { find } = setup()
    expect(find('pilot.action.run').params!.safeParse(params).success).toBe(ok)
  })

  it('lists the catalog', () => {
    expect(setup().call('pilot.action.list', null)).toEqual([
      { name: 'push', power: 'push', label: 'Push', usage: 'push …' }
    ])
  })

  const OUTSIDE =
    'Outside a Pilot run, approve actions in Pilot (Waiting on you), or run act.py directly.'
  const DESKTOP: RpcCallerIdentity = { kind: 'desktop' }
  const PHONE: RpcCallerIdentity = { kind: 'paired-device', deviceId: 'ipad' }
  const BOUND = { runId: 'run-2', stepIdx: 0 }

  // Approval comes only from the transport's caller identity (a person's own app or paired device),
  // never from params: an agent that drops its binding is an unbound local CLI, and is refused.
  it.each<[string, RpcCallerIdentity | undefined, Record<string, unknown>, string, object]>([
    ['desktop, unbound', DESKTOP, {}, '', { outcome: 'done' }],
    ['a paired device, unbound', PHONE, {}, '', { outcome: 'done' }],
    ['desktop, naming a run without its power', DESKTOP, BOUND, '', { outcome: 'done' }],
    ['the local CLI, unbound', LOCAL, {}, 'push', { outcome: 'failed', detail: OUTSIDE }],
    [
      'the local CLI, unbound, in a terminal of its own',
      LOCAL,
      { terminal: 'my-own-tab' },
      'push',
      { outcome: 'failed', detail: OUTSIDE }
    ],
    ['the local CLI bound to a step without the power', LOCAL, BOUND, '', { outcome: 'asked' }],
    ['the local CLI bound to a step with the power', LOCAL, BOUND, 'push', { outcome: 'done' }],
    [
      'no caller identity, unbound',
      undefined,
      {},
      'push',
      { outcome: 'failed', detail: "Pilot can't tell who is calling; nothing runs" }
    ],
    [
      'no caller identity, bound',
      undefined,
      BOUND,
      'push',
      { outcome: 'failed', detail: "Pilot can't tell who is calling; nothing runs" }
    ]
  ])('%s', async (_name, caller, target, powers, expected) => {
    const { push, call } = setup(powers)
    const ctx = caller ? { caller } : {}
    expect(await call('pilot.action.run', { ...PUSH, ...target }, ctx)).toMatchObject(expected)
    expect(vi.mocked(push.run).mock.calls.length).toBe(
      'outcome' in expected && expected.outcome === 'done' ? 1 : 0
    )
  })

  it.each<[string, RpcCallerIdentity | undefined, number]>([
    ['the local CLI, unbound, may dry-run', LOCAL, 1],
    ['no caller identity may not even dry-run', undefined, 0]
  ])('%s', async (_name, caller, runs) => {
    const { push, call } = setup()
    await call('pilot.action.run', { ...PUSH, dryRun: true }, caller ? { caller } : {})
    expect(push.run).toHaveBeenCalledTimes(runs)
    if (runs) {
      expect(push.run).toHaveBeenCalledWith(PUSH.args, { dryRun: true, runId: null })
    }
  })

  it('lists the catalog for any caller', () => {
    expect(setup().call('pilot.action.list', null, {})).toHaveLength(1)
  })

  it("takes the powers of the step bound to the caller's terminal, never the env's", async () => {
    const { store, push, call } = setup('push')
    store.runs.updateStep('run-1', 0, { status: 'running', terminalHandle: 'term-1' })
    expect(
      await call('pilot.action.run', { ...PUSH, terminal: 'term-1', runId: 'run-2', stepIdx: 0 })
    ).toMatchObject({ outcome: 'asked' })
    expect(push.run).not.toHaveBeenCalled()
    expect(store.inbox.list({})).toMatchObject([{ runId: 'run-1', automationId: 'ci' }])
  })

  it.each<[string, { runId: string; stepIdx?: number }, boolean, string]>([
    ['a run id without its step', { runId: 'run-2' }, false, "Not inside a Pilot run's step"],
    ['an ended step', { runId: 'run-2', stepIdx: 0 }, true, 'Step 0 of run run-2 has ended'],
    ['an unknown run', { runId: 'run-9', stepIdx: 0 }, false, 'No run run-9']
  ])('refuses %s, never treating it as a person', async (_name, target, ended, message) => {
    const { store, push, call } = setup('push')
    if (ended) {
      store.runs.updateStep('run-2', 0, { status: 'done' })
    }
    await expect(
      Promise.resolve().then(() => call('pilot.action.run', { ...PUSH, ...target }))
    ).rejects.toThrow(message)
    expect(push.run).not.toHaveBeenCalled()
  })

  it("runs an action the env step's run has the power for", async () => {
    const { push, call } = setup('push')
    expect(
      await call('pilot.action.run', { ...PUSH, runId: 'run-2', stepIdx: 0, dryRun: true })
    ).toMatchObject({ outcome: 'done' })
    expect(push.run).toHaveBeenCalledWith({ argv: ['a'] }, { dryRun: true, runId: 'run-2' })
  })
})

describe('action cards filed through pilot.inbox.add', () => {
  const CARD = { type: 'action', title: 'Push?', action: 'push', actionArgs: { argv: ['a'] } }

  it('files one the filing run has the power for', () => {
    const { call } = setup('push')
    expect(call('pilot.inbox.add', { ...CARD, runId: 'run-2', stepIdx: 0 })).toMatchObject({
      id: expect.any(String)
    })
  })

  it.each([
    [
      "the run's automation lacks the power",
      { ...CARD, runId: 'run-1', stepIdx: 0 },
      '"Fix CI" doesn\'t have the push power, so it can\'t propose push'
    ],
    [
      'a job-wide card from an automation without it',
      { ...CARD, automationId: 'ci', itemKey: 'mr:1' },
      '"Fix CI" doesn\'t have the push power'
    ],
    [
      'an unknown action',
      { ...CARD, action: 'deploy', runId: 'run-2', stepIdx: 0 },
      'No action named "deploy" in Pilot\'s catalog'
    ],
    [
      "args that don't fit",
      { ...CARD, actionArgs: { argv: 'a' }, runId: 'run-2', stepIdx: 0 },
      'usage: push …'
    ]
  ])('refuses one when %s', (_name, params, message) => {
    const { store, call } = setup('push')
    expect(() => call('pilot.inbox.add', params)).toThrow(message)
    expect(store.inbox.list({})).toEqual([])
  })
})
