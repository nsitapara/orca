import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { loadDefinitions } from '../definitions/loader'
import type { PilotHost } from '../pilot-services'
import { PilotStore } from '../store/store'
import { buildPilotMethods } from './methods'

type Callable = {
  name: string
  params: { safeParse(v: unknown): { success: boolean } } | null
  handler(p: unknown): unknown
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
      actions: { entries: () => [], get: () => null }
    }
  }
  const methods = buildPilotMethods(host) as unknown as Callable[]
  return {
    store,
    call: (name: string, p: unknown) => methods.find((m) => m.name === name)!.handler(p),
    find: (n: string) => methods.find((m) => m.name === n)!,
    methods
  }
}

describe('inbox RPC', () => {
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
})
