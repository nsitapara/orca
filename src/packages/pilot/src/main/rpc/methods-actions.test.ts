import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import type { ActionEntry } from '../actions/types'
import { loadDefinitions } from '../definitions/loader'
import type { PilotHost } from '../pilot-services'
import { PilotStore } from '../store/store'
import { buildPilotMethods } from './methods'

type Callable = {
  name: string
  params: { safeParse(v: unknown): { success: boolean } } | null
  handler(p: unknown): unknown
}

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
  return { store, push, find, call: (name: string, p: unknown) => find(name).handler(p) }
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

  it("enforces the env step's run powers, and treats a caller with no step at all as a person", async () => {
    const { push, call } = setup()
    expect(await call('pilot.action.run', { ...PUSH, runId: 'run-1', stepIdx: 0 })).toMatchObject({
      outcome: 'asked'
    })
    expect(push.run).not.toHaveBeenCalled()
    expect(await call('pilot.action.run', { ...PUSH, terminal: 'my-own-tab' })).toMatchObject({
      outcome: 'done'
    })
    expect(await call('pilot.action.run', PUSH)).toMatchObject({ outcome: 'done' })
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
