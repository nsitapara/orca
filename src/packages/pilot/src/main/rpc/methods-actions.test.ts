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
    name: 'publish',
    power: 'push',
    label: 'Push',
    usage: 'push …',
    checkArgs: (args) => (Array.isArray(args.argv) ? null : 'usage: push …'),
    describe: async () => 'Push b',
    run: vi
      .fn()
      .mockResolvedValue({ outcome: 'done', detail: 'pushed', link: null, log: null, onYou: false })
  } as ActionEntry
  const actions = { entries: () => [push], get: (n: string) => (n === 'publish' ? push : null) }
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
      actions,
      dispatcher: null,
      schedulerOn: true
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

const PUSH = { action: 'publish', args: { argv: ['a'] } }

describe('action RPC', () => {
  it.each([
    [{ action: 'publish', args: { argv: ['a'] } }, true],
    [{ action: 'publish', args: ['a'] }, false],
    [{ action: '', args: {} }, false],
    [{ action: 'linear_comment', args: { issue: 'WEB-1', body: 'x'.repeat(64 * 1024) } }, false]
  ])('checks run params %#', (params, ok) => {
    const { find } = setup()
    expect(find('pilot.action.run').params!.safeParse(params).success).toBe(ok)
  })

  it('lists the catalog', () => {
    expect(setup().call('pilot.action.list', null)).toEqual([
      { name: 'publish', power: 'push', label: 'Push', usage: 'push …' }
    ])
  })

  const OUTSIDE = 'Outside a Pilot run, approve actions in Pilot (Inbox).'
  const NO_CALLER = "Pilot can't tell who is calling; nothing runs"
  const DESKTOP: RpcCallerIdentity = { kind: 'desktop' }
  const PHONE: RpcCallerIdentity = { kind: 'paired-device', deviceId: 'ipad' }
  const BOUND = { runId: 'run-2', stepIdx: 0 }
  const REFUSED = (detail: string) => ({ outcome: 'failed', detail })

  // pilot.action.run approves nothing, for any caller: a call bound to a run gets that run's powers, an
  // unbound one only dry-runs, and a call the transport can't name is refused. Every refusal is a row.
  it.each<[string, RpcCallerIdentity | undefined, Record<string, unknown>, string, object, number]>(
    [
      ['desktop, unbound', DESKTOP, {}, 'push', REFUSED(OUTSIDE), 0],
      ['desktop, unbound, dry run', DESKTOP, { dryRun: true }, '', { outcome: 'done' }, 1],
      ['a paired device, unbound', PHONE, {}, 'push', REFUSED(OUTSIDE), 0],
      ['a paired device, unbound, dry run', PHONE, { dryRun: true }, '', { outcome: 'done' }, 1],
      ['the local CLI, unbound', LOCAL, {}, 'push', REFUSED(OUTSIDE), 0],
      [
        'the local CLI, unbound, own terminal',
        LOCAL,
        { terminal: 'my-own-tab' },
        'push',
        REFUSED(OUTSIDE),
        0
      ],
      ['the local CLI, unbound, dry run', LOCAL, { dryRun: true }, '', { outcome: 'done' }, 1],
      [
        'the local CLI bound to a step without the power',
        LOCAL,
        BOUND,
        '',
        { outcome: 'asked' },
        0
      ],
      [
        'the local CLI bound to a step with the power',
        LOCAL,
        BOUND,
        'push',
        { outcome: 'done' },
        1
      ],
      ['no caller identity, unbound', undefined, {}, 'push', REFUSED(NO_CALLER), 0],
      ['no caller identity, dry run', undefined, { dryRun: true }, 'push', REFUSED(NO_CALLER), 0],
      ['no caller identity, bound', undefined, BOUND, 'push', REFUSED(NO_CALLER), 0]
    ]
  )('%s', async (_name, caller, extra, powers, expected, runs) => {
    const { store, push, call } = setup(powers)
    const ctx = caller ? { caller } : {}
    expect(await call('pilot.action.run', { ...PUSH, ...extra }, ctx)).toMatchObject(expected)
    expect(push.run).toHaveBeenCalledTimes(runs)
    const status = runs ? 'done' : 'refused'
    expect(store.actions.get(1)).toMatchObject({ action: 'publish', status })
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
  ])('refuses %s, and records the refusal', async (_name, target, ended, message) => {
    const { store, push, call } = setup('push')
    if (ended) {
      store.runs.updateStep('run-2', 0, { status: 'done' })
    }
    expect(await call('pilot.action.run', { ...PUSH, ...target })).toMatchObject({
      outcome: 'failed',
      detail: expect.stringContaining(message)
    })
    expect(push.run).not.toHaveBeenCalled()
    expect(store.actions.get(1)).toMatchObject({
      action: 'publish',
      status: 'refused',
      runId: null
    })
  })

  it("runs an action the env step's run has the power for", async () => {
    const { push, call } = setup('push')
    expect(
      await call('pilot.action.run', { ...PUSH, runId: 'run-2', stepIdx: 0, dryRun: true })
    ).toMatchObject({ outcome: 'done' })
    expect(push.run).toHaveBeenCalledWith(
      { argv: ['a'] },
      { dryRun: true, runId: 'run-2', inboxItemId: null }
    )
  })
})

describe('action cards filed through pilot.inbox.add', () => {
  const CARD = { type: 'action', title: 'Push?', action: 'publish', actionArgs: { argv: ['a'] } }

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
      '"Fix CI" doesn\'t have the push power, so it can\'t propose publish'
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
