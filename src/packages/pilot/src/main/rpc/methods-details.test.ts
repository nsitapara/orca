import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import type { RpcCallerIdentity } from '../../../../../main/runtime/rpc/rpc-caller-identity'
import { loadDefinitions } from '../definitions/loader'
import { detailsFixture } from '../inbox/__fixtures__/details-fixture'
import { loadDetails } from '../inbox/details-bundle'
import { addInboxItem } from '../inbox/inbox-add'
import type { PilotHost } from '../pilot-services'
import { PilotStore } from '../store/store'
import { buildPilotMethods } from './methods'

type Callable = {
  name: string
  permission: string
  handler(p: unknown, ctx?: { caller?: RpcCallerIdentity }): unknown
}

const DESKTOP: RpcCallerIdentity = { kind: 'desktop' }
const CLI: RpcCallerIdentity = { kind: 'local-cli' }

function detailsSetup() {
  const f = detailsFixture()
  const dir = mkdtempSync(join(tmpdir(), 'pilot-details-rpc-'))
  writeFileSync(join(dir, 'people.yaml'), 'people:\n  - { id: nish, name: Nish, gitlab: nish8 }\n')
  for (const id of ['ci', 'qa']) {
    writeFileSync(
      join(dir, `${id}.yaml`),
      `name: ${id}\nrepo: r\nschedule: manual\nitems: { kind: merge_request }\nsteps: [ { agent: claude, prompt: x } ]\ninbox: nish\n`
    )
  }
  const loaded = loadDefinitions([dir])
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
      loaded: () => loaded,
      reload: () => loaded,
      scheduler: null as never,
      actions: { entries: () => [], get: () => null },
      dispatcher: null,
      schedulerOn: true,
      detailsRoot: f.root
    }
  }
  const methods = buildPilotMethods(host) as unknown as Callable[]
  const deps = {
    store,
    now: () => 100,
    definitions: () => loaded.definitions,
    people: () => loaded.people,
    detailsRoot: f.root
  }
  const add = (bundle: string | null, automationId = 'ci') =>
    addInboxItem(deps, {
      automationId,
      itemKey: 'mr:1',
      type: 'bug',
      title: `A ${automationId} card`,
      ...(bundle ? { detailsBundlePath: bundle } : {})
    }).id ?? ''
  return {
    f,
    store,
    deps,
    add,
    callAs: (caller: RpcCallerIdentity | undefined, name: string, p: unknown) =>
      methods.find((m) => m.name === name)!.handler(p, caller ? { caller } : {}),
    find: (name: string) => methods.find((m) => m.name === name)
  }
}

describe("a card's Details over RPC", () => {
  it('registers pilot.inbox.details and pilot.inbox.image as workspace methods', () => {
    const { find } = detailsSetup()
    for (const name of ['pilot.inbox.details', 'pilot.inbox.image']) {
      expect(find(name)).toMatchObject({ permission: 'workspace', pilot: true })
    }
  })

  it('reads the snapshot of the version shown, by its digest or without one', () => {
    const { f, store, add, callAs } = detailsSetup()
    const id = add(f.bundle)
    const digest = store.inbox.get(id)?.digest
    const expected = { id, digest, snapshot: store.inbox.snapshot(id) }
    expect(callAs(DESKTOP, 'pilot.inbox.details', { id, digest })).toEqual(expected)
    expect(callAs(CLI, 'pilot.inbox.details', { id })).toEqual(expected)
  })

  it('serves an image the bundle names, as its type and bytes', () => {
    const { f, store, add, callAs } = detailsSetup()
    const id = add(f.bundle)
    const digest = store.inbox.get(id)?.digest
    const bytes = readFileSync(join(f.dir, 'F2-qa.png'))
    expect(callAs(DESKTOP, 'pilot.inbox.image', { id, digest, file: 'F2-qa.png' })).toEqual({
      mime: 'image/png',
      base64: bytes.toString('base64'),
      bytes: bytes.length
    })
  })

  it.each([
    ['details', { file: undefined }],
    ['image', { file: 'F2-qa.png' }]
  ])('refuses a digest that is not the current one (%s)', (method, extra) => {
    const { f, add, callAs } = detailsSetup()
    const id = add(f.bundle)
    const stale = { id, digest: 'f'.repeat(64), ...extra }
    expect(() => callAs(DESKTOP, `pilot.inbox.${method}`, stale)).toThrow(
      'The card changed; review it again'
    )
  })

  it('refuses a file that is not an image of the card', () => {
    const { f, store, add, callAs } = detailsSetup()
    const id = add(f.bundle)
    const digest = store.inbox.get(id)?.digest
    expect(() => callAs(DESKTOP, 'pilot.inbox.image', { id, digest, file: '../x.png' })).toThrow(
      /^Details bundle refused: /
    )
  })

  it.each(['details', 'image'])('refuses a caller Pilot cannot name (%s)', (method) => {
    const { f, store, add, callAs } = detailsSetup()
    const id = add(f.bundle)
    const digest = store.inbox.get(id)?.digest
    expect(() =>
      callAs(undefined, `pilot.inbox.${method}`, { id, digest, file: 'F2-qa.png' })
    ).toThrow("Pilot can't tell who is calling; nothing was read")
  })

  it.each(['details', 'image'])('refuses a card without a bundle (%s)', (method) => {
    const { store, add, callAs } = detailsSetup()
    const id = add(null)
    const digest = store.inbox.get(id)?.digest
    expect(() => callAs(DESKTOP, `pilot.inbox.${method}`, { id, digest, file: 'x.png' })).toThrow(
      'This card has no Details bundle'
    )
  })
})

// run-1 (ci) runs its step on term-1; run-2 (qa) runs its step for the env; run-3 (ci)'s step has ended.
function withRuns(store: PilotStore): void {
  for (const [id, automationId] of [
    ['run-1', 'ci'],
    ['run-2', 'qa'],
    ['run-3', 'ci']
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
      name: 'draft',
      agent: 'claude',
      skill: null,
      mode: null,
      startedAt: 1,
      status: 'running'
    })
  }
  store.runs.updateStep('run-1', 0, { terminalHandle: 'term-1' })
  store.runs.updateStep('run-3', 0, { status: 'done' })
}

const PAIRED: RpcCallerIdentity = { kind: 'paired-device', deviceId: 'phone' }
const RUN_ONLY = "Attach Details from a Pilot run's step, for a card of that run's automation"

describe('pilot.inbox.setDetails: who may replace a bundle', () => {
  it.each<[string, RpcCallerIdentity, Record<string, unknown>]>([
    ['the desktop', DESKTOP, {}],
    ["a step of the card's automation, on its terminal", CLI, { terminal: 'term-1' }]
  ])('lets %s attach it', (_name, caller, binding) => {
    const { f, store, add, callAs } = detailsSetup()
    withRuns(store)
    const id = add(null)
    expect(
      callAs(caller, 'pilot.inbox.setDetails', { id, bundlePath: f.bundle, ...binding })
    ).toEqual({ id, version: 2, changed: true, cleared: false })
    expect(store.inbox.get(id)?.details?.sha256).toBe(store.inbox.snapshot(id)?.ref.sha256)
  })

  it.each<[string, RpcCallerIdentity | undefined, Record<string, unknown>, string]>([
    [
      "a step of another automation's run",
      CLI,
      { runId: 'run-2', stepIdx: 0 },
      'This run belongs to another automation than the card'
    ],
    ['the local CLI bound to no run', CLI, {}, RUN_ONLY],
    [
      "an ended run's env binding",
      CLI,
      { runId: 'run-3', stepIdx: 0 },
      `${RUN_ONLY} (Step 0 of run run-3 has ended`
    ],
    ['a paired device', PAIRED, {}, RUN_ONLY],
    ['a caller Pilot cannot name', undefined, {}, "Pilot can't tell who is calling"]
  ])('refuses %s and leaves the card alone', (_name, caller, binding, message) => {
    const { f, store, add, callAs } = detailsSetup()
    withRuns(store)
    const id = add(null)
    const before = store.inbox.get(id)
    expect(() =>
      callAs(caller, 'pilot.inbox.setDetails', { id, bundlePath: f.bundle, ...binding })
    ).toThrow(message)
    expect(store.inbox.get(id)).toEqual(before)
    expect(store.inbox.snapshot(id)).toBeNull()
  })

  it('refuses a caller kind it does not know', () => {
    const { f, add, callAs } = detailsSetup()
    const id = add(null)
    const odd = { kind: 'plugin' } as unknown as RpcCallerIdentity
    expect(() => callAs(odd, 'pilot.inbox.setDetails', { id, bundlePath: f.bundle })).toThrow(
      RUN_ONLY
    )
  })

  it.each([
    [{ id: 'in_x', bundlePath: '' }],
    [{ id: 'in_x', bundlePath: '/v/F2.json', head: 'xyz' }],
    [{ id: 'in_x', bundlePath: '/v/F2.json', head: '12345' }]
  ])('refuses params %j', (params) => {
    const { find } = detailsSetup()
    const method = find('pilot.inbox.setDetails') as unknown as {
      params: { safeParse(v: unknown): { success: boolean } }
    }
    expect(method.params.safeParse(params).success).toBe(false)
  })
})

// pilot.inbox.add with a bundle can change an open card (and clear its answer), so it asks what
// set-details asks: the desktop, or the local CLI bound to a run of the card's own automation.
describe('pilot.inbox.add with a bundle: the scope of set-details', () => {
  function answeredCiCard() {
    const s = detailsSetup()
    withRuns(s.store)
    const id = s.add(null)
    const digest = s.store.inbox.get(id)?.digest ?? ''
    s.store.inbox.saveAnswer(id, { option: 0, text: null, digest, via: 'page' }, 'nish', 110)
    const card = {
      automationId: 'ci',
      itemKey: 'mr:1',
      type: 'bug',
      title: 'A ci card',
      detailsBundlePath: s.f.bundle
    }
    return { ...s, id, card }
  }

  it.each<[string, RpcCallerIdentity | undefined, Record<string, unknown>, string]>([
    ['the local CLI bound to no run', CLI, {}, RUN_ONLY],
    ['the local CLI in a terminal with no step', CLI, { terminal: 'term-9' }, RUN_ONLY],
    ['a paired device', PAIRED, {}, RUN_ONLY],
    ['a caller Pilot cannot name', undefined, {}, "Pilot can't tell who is calling"]
  ])('refuses %s, and the answered card keeps its answer', (_name, caller, binding, message) => {
    const { store, id, card, callAs } = answeredCiCard()
    const before = store.inbox.get(id)
    expect(() => callAs(caller, 'pilot.inbox.add', { ...card, ...binding })).toThrow(message)
    expect(store.inbox.get(id)).toEqual(before)
    expect(store.inbox.list()).toHaveLength(1)
  })

  it("files another automation's run's bundle under that run, never on this card", () => {
    const { store, id, card, callAs } = answeredCiCard()
    const before = store.inbox.get(id)
    const added = callAs(CLI, 'pilot.inbox.add', { ...card, runId: 'run-2', stepIdx: 0 }) as {
      id: string
    }
    expect(store.inbox.get(added.id)).toMatchObject({ automationId: 'qa', runId: 'run-2' })
    expect(store.inbox.get(id)).toEqual(before)
  })

  it.each<[string, RpcCallerIdentity, Record<string, unknown>]>([
    ['the desktop', DESKTOP, {}],
    ["a step of the card's own automation", CLI, { terminal: 'term-1' }]
  ])('lets %s add it', (_name, caller, binding) => {
    const { f, store, card, callAs } = answeredCiCard()
    const added = callAs(caller, 'pilot.inbox.add', { ...card, ...binding }) as { id: string }
    expect(store.inbox.get(added.id)?.details?.sha256).toBe(
      loadDetails(f.root, f.bundle).ref.sha256
    )
  })

  it('still takes the card without its bundle when a bound step retries after a refused bundle', () => {
    const { f, store, card, callAs } = answeredCiCard()
    writeFileSync(f.bundle, '{"version": 2}')
    const bound = { ...card, terminal: 'term-1' }
    expect(() => callAs(CLI, 'pilot.inbox.add', bound)).toThrow(/^Details bundle refused: /)
    const { detailsBundlePath: _bundle, ...plain } = bound
    const added = callAs(CLI, 'pilot.inbox.add', plain) as { id: string }
    expect(store.inbox.get(added.id)).toMatchObject({ automationId: 'ci', runId: 'run-1' })
  })
})
