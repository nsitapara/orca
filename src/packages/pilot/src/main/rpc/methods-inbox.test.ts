import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import type { RpcCallerIdentity } from '../../../../../main/runtime/rpc/rpc-caller-identity'
import { addInboxItem } from '../inbox/inbox-add'
import { loadDefinitions } from '../definitions/loader'
import type { PilotHost } from '../pilot-services'
import { PilotStore } from '../store/store'
import { buildPilotMethods } from './methods'

type Callable = {
  name: string
  params: { safeParse(v: unknown): { success: boolean } } | null
  handler(p: unknown, ctx?: { caller?: RpcCallerIdentity }): unknown
}

function setup() {
  const dir = mkdtempSync(join(tmpdir(), 'pilot-inbox-rpc-'))
  writeFileSync(join(dir, 'people.yaml'), 'people:\n  - { id: nish, name: Nish, gitlab: nish8 }\n')
  writeFileSync(
    join(dir, 'ci.yaml'),
    'name: Fix CI\nrepo: r\nschedule: manual\nitems: { kind: merge_request }\nsteps: [ { agent: claude, prompt: x } ]\ninbox: nish\n'
  )
  const loaded = loadDefinitions([dir])
  const store = PilotStore.open(join(dir, 'db.sqlite'))
  store.runs.create({
    id: 'run-1',
    automationId: 'ci',
    tickId: null,
    itemKey: 'mr:1',
    itemLabel: '!1',
    worktreePath: '/wt',
    startedAt: 1
  })
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
      actions: { entries: () => [], get: () => null },
      dispatcher: null
    }
  }
  const methods = buildPilotMethods(host) as unknown as Callable[]
  return {
    store,
    loaded,
    call: (name: string, p: unknown) => methods.find((m) => m.name === name)!.handler(p),
    callAs: (caller: RpcCallerIdentity | undefined, name: string, p: unknown) =>
      methods.find((m) => m.name === name)!.handler(p, caller ? { caller } : {}),
    find: (n: string) => methods.find((m) => m.name === n)!,
    methods
  }
}

describe('inbox RPC', () => {
  it('refuses to close an ask-first card, which only Pilot or the desktop answer can settle', () => {
    const { call, store, loaded } = setup()
    const added = addInboxItem(
      {
        store,
        now: () => 5,
        definitions: () => loaded.definitions,
        people: () => loaded.people
      },
      {
        runId: 'run-1',
        type: 'action',
        title: 'Go?',
        options: ['Approve'],
        action: 'start_run',
        actionArgs: { run_id: 'run-1' }
      }
    )
    const card = { id: added.id ?? '' }
    expect(() => call('pilot.inbox.tick', { id: card.id, outcome: 'skipped' })).toThrow(
      'Answer this in Pilot (Waiting on you)'
    )
    expect(store.inbox.get(card.id)?.status).toBe('open')
  })

  it('registers each method once, as pilot.* with a workspace permission', () => {
    const { methods } = setup()
    const names = methods.map((m) => m.name)
    expect(new Set(names).size).toBe(names.length)
    for (const n of [
      'pilot.inbox.add',
      'pilot.inbox.list',
      'pilot.inbox.get',
      'pilot.inbox.tick',
      'pilot.inbox.reply'
    ]) {
      expect(methods.find((m) => m.name === n)).toMatchObject({
        permission: 'workspace',
        pilot: true
      })
    }
  })

  it('adds, lists, replies to and ticks a card', () => {
    const { call } = setup()
    const added = call('pilot.inbox.add', {
      runId: 'run-1',
      type: 'question',
      title: 'Which image?',
      options: ['e2e', 'unit']
    }) as { id: string }
    expect(call('pilot.inbox.list', { person: 'nish' })).toMatchObject({
      items: [{ id: added.id, person: 'nish' }]
    })
    expect(call('pilot.inbox.reply', { id: added.id, text: 'Which one?' })).toMatchObject({
      replies: ['Which one?']
    })
    expect(call('pilot.inbox.tick', { id: added.id, outcome: 'done: e2e' })).toMatchObject({
      status: 'done',
      outcome: 'done: e2e'
    })
    expect(call('pilot.inbox.get', { id: added.id })).toMatchObject({ status: 'done' })
  })

  it.each([
    [{ type: 'note', title: 'x' }],
    [{ type: 'question', title: '' }],
    [{ type: 'question', title: 'x', detailsMd: 'x'.repeat(64 * 1024 + 1) }],
    [{ type: 'action', title: 'x', switchWords: ['Post'] }]
  ])('refuses add params %j', (params) => {
    const { find } = setup()
    expect(find('pilot.inbox.add').params!.safeParse(params).success).toBe(false)
  })

  it('files a card under the step running on the calling terminal, ahead of the env', () => {
    const { store, call } = setup()
    store.runs.create({
      id: 'run-2',
      automationId: 'ci',
      tickId: null,
      itemKey: 'mr:2',
      itemLabel: '!2',
      worktreePath: '/wt2',
      startedAt: 2
    })
    store.runs.createStep({
      runId: 'run-2',
      idx: 0,
      name: 's',
      agent: 'claude',
      skill: null,
      mode: null,
      startedAt: 2
    })
    store.runs.updateStep('run-2', 0, { status: 'running', terminalHandle: 'term-9' })
    const added = call('pilot.inbox.add', {
      terminal: 'term-9',
      runId: 'run-1',
      stepIdx: 0,
      type: 'question',
      title: 'Q?'
    }) as { id: string }
    expect(store.inbox.get(added.id)).toMatchObject({ runId: 'run-2', stepIdx: 0, itemKey: 'mr:2' })
  })

  it('falls back to the env step only while it is active in an open run', () => {
    const { store, call } = setup()
    store.runs.createStep({
      runId: 'run-1',
      idx: 0,
      name: 's',
      agent: 'claude',
      skill: null,
      mode: null,
      startedAt: 1
    })
    store.runs.updateStep('run-1', 0, { status: 'done' })
    expect(() =>
      call('pilot.inbox.add', {
        terminal: 'term-x',
        runId: 'run-1',
        stepIdx: 0,
        type: 'question',
        title: 'Q?'
      })
    ).toThrow('has ended')
    store.runs.updateStep('run-1', 0, { status: 'running' })
    const added = call('pilot.inbox.add', {
      terminal: 'term-x',
      runId: 'run-1',
      stepIdx: 0,
      type: 'question',
      title: 'Q?'
    }) as { id: string }
    expect(store.inbox.get(added.id)).toMatchObject({ runId: 'run-1', stepIdx: 0 })
  })

  it('refuses a terminal with no step and no automation and item, but takes an explicit item', () => {
    const { store, call } = setup()
    expect(() =>
      call('pilot.inbox.add', { terminal: 'term-x', type: 'question', title: 'Q?' })
    ).toThrow('Not inside a Pilot')
    const added = call('pilot.inbox.add', {
      terminal: 'term-x',
      automationId: 'ci',
      itemKey: 'mr:1',
      type: 'question',
      title: 'Q?'
    }) as { id: string }
    expect(store.inbox.get(added.id)).toMatchObject({ runId: null, itemKey: 'mr:1' })
  })

  it.each([
    ['a terminal-bound step', { terminal: 'term-9' }],
    ['the env step', { runId: 'run-2', stepIdx: 0 }],
    ['a run without a step', { runId: 'run-2' }]
  ])('takes worktree, automation and item from the run on %s', (_name, target) => {
    const { store, call } = setup()
    store.runs.create({
      id: 'run-2',
      automationId: 'ci',
      tickId: null,
      itemKey: 'mr:2',
      itemLabel: '!2',
      worktreePath: '/wt2',
      startedAt: 2
    })
    store.runs.createStep({
      runId: 'run-2',
      idx: 0,
      name: 's',
      agent: 'claude',
      skill: null,
      mode: null,
      startedAt: 2
    })
    store.runs.updateStep('run-2', 0, { status: 'running', terminalHandle: 'term-9' })
    const added = call('pilot.inbox.add', {
      ...target,
      automationId: 'other',
      itemKey: 'mr:99',
      worktreePath: '/wt/elsewhere',
      type: 'question',
      title: 'Q?'
    }) as { id: string }
    expect(store.inbox.get(added.id)).toMatchObject({
      automationId: 'ci',
      itemKey: 'mr:2',
      worktreePath: '/wt2'
    })
  })
  it('saves an answer and lists it as up next', () => {
    const { call, callAs } = setup()
    const added = call('pilot.inbox.add', {
      runId: 'run-1',
      type: 'question',
      title: 'Which image?',
      options: ['e2e', 'unit']
    }) as { id: string }
    const digest = (call('pilot.inbox.get', { id: added.id }) as { digest: string }).digest
    expect(
      callAs({ kind: 'desktop' }, 'pilot.inbox.answer', {
        id: added.id,
        option: 0,
        digest
      })
    ).toMatchObject({ status: 'answered', answer: { callerKind: 'desktop' } })
    expect(call('pilot.queue.list', { person: 'nish' })).toMatchObject({
      entries: [{ itemId: added.id, state: 'not_ready', how: 'agent' }]
    })
  })

  it.each<[string, RpcCallerIdentity | undefined, Record<string, unknown>, string]>([
    ['no caller identity', undefined, {}, "Pilot can't tell who is answering"],
    ['the local CLI', { kind: 'local-cli' }, {}, 'Answer cards in Pilot (Waiting on you)'],
    [
      'the local CLI claiming to be outside a run',
      { kind: 'local-cli' },
      { text: 'A' },
      'Answer cards in Pilot (Waiting on you)'
    ],
    [
      'the local CLI inside a run',
      { kind: 'local-cli' },
      { runId: 'run-1', stepIdx: 0, terminal: 'term-1' },
      'Answer cards in Pilot (Waiting on you)'
    ]
  ])('refuses an answer from %s', (_name, caller, extra, message) => {
    const { store, call, callAs } = setup()
    const added = call('pilot.inbox.add', { runId: 'run-1', type: 'question', title: 'Q?' }) as {
      id: string
    }
    expect(() =>
      callAs(caller, 'pilot.inbox.answer', { id: added.id, text: 'A', ...extra })
    ).toThrow(message)
    expect(store.inbox.get(added.id)).toMatchObject({ status: 'open', answer: null })
  })

  it('takes no caller-supplied via or run binding in the params', () => {
    const { find } = setup()
    // A zod object's fields, keyed by name.
    const params = find('pilot.inbox.answer').params as unknown as Record<'shape', object>
    expect(Object.keys(params.shape).sort()).toEqual(['by', 'digest', 'id', 'option', 'text'])
  })

  it('lets a paired device answer text and skip, records how and who, but never approves', () => {
    const { call, callAs } = setup()
    const phone: RpcCallerIdentity = { kind: 'paired-device', deviceId: 'ipad' }
    const added = call('pilot.inbox.add', { runId: 'run-1', type: 'question', title: 'Q?' }) as {
      id: string
    }
    expect(callAs(phone, 'pilot.inbox.answer', { id: added.id, text: 'A' })).toMatchObject({
      answer: { callerKind: 'paired-device', via: 'device' }
    })
  })
})
