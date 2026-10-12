import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import type { RpcCallerIdentity } from '../../../../../main/runtime/rpc/rpc-caller-identity'
import { loadDefinitions } from '../definitions/loader'
import { detailsFixture } from '../inbox/__fixtures__/details-fixture'
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
