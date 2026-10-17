import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import type { RpcCallerIdentity } from '../../../../../main/runtime/rpc/rpc-caller-identity'
import type { InboxItemRow } from '../../shared/api-types'
import { NEEDS_EVIDENCE } from '../../shared/evidence'
import { PREPARATION_NOT_READY, queuedPreparation } from '../../shared/preparation'
import { cardToRun } from '../actions/powers'
import type { ActionEntry } from '../actions/types'
import { applyScript } from '../answers/apply-script'
import { draftApproved } from '../answers/draft-grant'
import { saveAnswer } from '../answers/save'
import { loadDefinitions } from '../definitions/loader'
import type { PilotHost } from '../pilot-services'
import { buildPilotMethods } from '../rpc/methods'
import { PilotStore } from '../store/store'
import type { NewInboxItem } from '../store/store-inbox'
import { addInboxItem } from './inbox-add'
import { buildInboxDeps, listInbox } from './inbox-service'

// R-P5: an evidence-needing decision (push, applying a drafted change) runs only from a prepared card
// whose preparation is ready. The rule reads the card, never who added it or how the caller is bound.
type Callable = { name: string; handler(p: unknown, ctx?: { caller?: RpcCallerIdentity }): unknown }
const ARGV = ['/wt', 'web-1', 'a'.repeat(40), 'b'.repeat(40)]

function pushEntry(): ActionEntry {
  return {
    name: 'push',
    power: 'push',
    label: 'push',
    usage: 'push',
    checkArgs: () => null,
    describe: async () => 'push',
    run: vi.fn(async () => ({
      outcome: 'done' as const,
      detail: 'ran',
      link: null,
      log: null,
      onYou: false
    }))
  }
}

function setup() {
  const dir = mkdtempSync(join(tmpdir(), 'pilot-evidence-'))
  writeFileSync(join(dir, 'people.yaml'), 'people:\n  - { id: nish, name: Nish }\n')
  writeFileSync(
    join(dir, 'ci.yaml'),
    'name: ci\nrepo: r\nschedule: manual\nitems: { kind: merge_request }\nsteps: [ { agent: claude, prompt: x } ]\npowers: [push]\ninbox: nish\n'
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
  const entries = [pushEntry()]
  const actions = {
    entries: () => entries,
    get: (n: string) => entries.find((e) => e.name === n) ?? null
  }
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
      schedulerOn: true,
      detailsRoot: null
    }
  }
  const methods = buildPilotMethods(host) as unknown as Callable[]
  const inbox = buildInboxDeps({
    store,
    now: () => 100,
    definitions: () => loaded.definitions,
    people: () => loaded.people,
    actions,
    onResolved: null
  })
  const callAs = (caller: RpcCallerIdentity | undefined, name: string, p: unknown) =>
    methods.find((m) => m.name === name)!.handler(p, caller ? { caller } : {})
  return { store, inbox, actions, callAs }
}

// A card as an older build stored it: plain, never through today's add.
function legacy(store: PilotStore, over: Partial<NewInboxItem>): InboxItemRow {
  store.inbox.add({
    id: 'in_legacy00000001',
    automationId: 'ci',
    runId: 'run-1',
    stepIdx: null,
    itemKey: 'mr:1',
    worktreePath: '/wt',
    person: 'nish',
    type: 'action',
    title: 'Push !1?',
    context: 'Pushes 2 commits',
    options: [
      { label: 'Approve', meaning: 'push' },
      { label: 'Skip', meaning: 'keep' }
    ],
    suggested: null,
    detailsMd: null,
    action: 'push',
    actionArgs: { argv: ARGV },
    digest: 'd'.repeat(64),
    createdAt: 1,
    source: 'engine',
    vaultRef: null,
    ...over
  })
  return store.inbox.get('in_legacy00000001')!
}

const DRAFTED = {
  path: '/v/b.json',
  sha256: '0'.repeat(64),
  inlined: {},
  blocks: 1,
  drafted: true,
  draftedBase: 'c'.repeat(40)
}

describe('R-P5 at add: a push or Post card comes with a preparation request, whoever adds it', () => {
  const PUSH = { type: 'action', title: 'Push !1?', action: 'push', actionArgs: { argv: ARGV } }
  it.each<[string, RpcCallerIdentity, object]>([
    ['the desktop', { kind: 'desktop' }, { automationId: 'ci', itemKey: 'mr:1' }],
    [
      'a paired device',
      { kind: 'paired-device', deviceId: 'p' },
      { automationId: 'ci', itemKey: 'mr:1' }
    ],
    ['an unbound CLI', { kind: 'local-cli' }, { automationId: 'ci', itemKey: 'mr:1' }],
    ['a run-bound CLI', { kind: 'local-cli' }, { runId: 'run-1' }]
  ])('refuses %s', (_who, caller, target) => {
    const { store, callAs } = setup()
    expect(() => callAs(caller, 'pilot.inbox.add', { ...PUSH, ...target })).toThrow(
      'push needs prepared evidence'
    )
    expect(store.inbox.list()).toEqual([])
  })
})

describe('R-P5 at approve and apply', () => {
  it('refuses Approve on a legacy push row, and lets Skip close it', () => {
    const { store, inbox, actions } = setup()
    const card = legacy(store, {})
    const origin = { callerKind: 'desktop' as const, catalog: actions }
    expect(() =>
      saveAnswer(inbox, { id: card.id, digest: card.digest, text: 'Approve' }, origin)
    ).toThrow(NEEDS_EVIDENCE)
    expect(
      saveAnswer(inbox, { id: card.id, digest: card.digest, text: 'Skip' }, origin)
    ).toMatchObject({
      status: 'answered'
    })
  })

  it('never runs a legacy push from its card', () => {
    const { store, actions } = setup()
    const card = legacy(store, {})
    expect(
      cardToRun(
        { store, catalog: actions } as never,
        actions.get('push')!,
        { runId: 'run-1', digest: card.digest },
        card.id
      )
    ).toEqual({ problem: NEEDS_EVIDENCE })
  })

  it('re-asks an approval of a legacy push already in the queue, and runs nothing', async () => {
    const { store, inbox, actions } = setup()
    const card = legacy(store, {})
    store.inbox.saveAnswer(
      card.id,
      { option: null, text: 'Approve', digest: card.digest, via: 'page', callerKind: 'desktop' },
      'nish',
      100
    )
    const attempt = {
      store,
      now: () => 100,
      catalog: actions,
      definitions: inbox.definitions,
      inbox
    }
    const step = await applyScript({ inbox, attempt }, store.inbox.get(card.id)!, [])
    expect(step).toEqual({ kind: 'reasked' })
    expect(actions.get('push')!.run).not.toHaveBeenCalled()
    expect(store.inbox.get(card.id)?.replies.at(-1)?.text).toBe(NEEDS_EVIDENCE)
  })

  it('grants a drafted patch only on a prepared card whose preparation is ready', () => {
    const { store } = setup()
    const answer = {
      option: null,
      text: 'Approve',
      digest: 'd'.repeat(64),
      via: 'page' as const,
      callerKind: 'desktop' as const
    }
    const plain = {
      ...legacy(store, { type: 'bug', action: null, actionArgs: null, details: DRAFTED }),
      status: 'answered' as const,
      answer
    }
    expect(draftApproved(plain)).toBe(false)
    const input = { key: 'k', context: 'c', requirements: ['context' as const] }
    const preparing = { ...plain, preparation: queuedPreparation(input, 1) }
    expect(draftApproved(preparing)).toBe(false)
    expect(
      draftApproved({
        ...preparing,
        preparation: { ...preparing.preparation, state: 'ready' as const }
      })
    ).toBe(true)
  })

  it('still says a prepared card is not ready yet', () => {
    const { store, actions } = setup()
    const input = { key: 'k', context: 'c', requirements: ['context' as const] }
    const card = legacy(store, { preparation: queuedPreparation(input, 1) })
    expect(
      cardToRun(
        { store, catalog: actions } as never,
        actions.get('push')!,
        { runId: 'run-1', digest: card.digest },
        card.id
      )
    ).toEqual({ problem: PREPARATION_NOT_READY })
  })
})

describe('R-P5 for a run-bound add', () => {
  it('is the same rule through addInboxItem, with no catalog flag needed', () => {
    const { store } = setup()
    const deps = {
      store,
      now: () => 1,
      definitions: () => [],
      people: () => ({ people: [], groups: [] })
    }
    expect(() =>
      addInboxItem(deps as never, {
        runId: 'run-1',
        type: 'action',
        title: 'x',
        action: 'push',
        actionArgs: { argv: ARGV }
      })
    ).toThrow('push needs prepared evidence')
  })
})

// R-P5 for cards an older build stored (and imports): they show Needs evidence, and a person's Prepare evidence
// queues them for job 14 with a request built from the card, through the intake shape.
describe('a legacy evidence-needing card', () => {
  it('lists as needing evidence; a prepared or plain question card does not', () => {
    const { store, inbox } = setup()
    legacy(store, {})
    const [row] = listInbox(inbox, {}).items
    expect(row).toMatchObject({ needsEvidence: true })
    store.inbox.update(row.id, { status: 'done' }, 2)
    legacy(store, {
      id: 'in_legacy00000002',
      type: 'question',
      action: null,
      actionArgs: null
    } as never)
    expect(listInbox(inbox, {}).items).toMatchObject([{ needsEvidence: false }])
  })

  it.each<[string, Partial<NewInboxItem>, string[]]>([
    ['a push', {}, ['context', 'diff', 'checks']],
    [
      'a drafted change',
      { type: 'bug', action: null, actionArgs: null, details: DRAFTED },
      ['context', 'diff', 'checks']
    ]
  ])('is queued for job 14 by a person: %s', (_what, over, requirements) => {
    const { store, callAs } = setup()
    const card = legacy(store, over)
    const prepared = callAs({ kind: 'desktop' }, 'pilot.inbox.prepareEvidence', {
      id: card.id
    }) as InboxItemRow
    expect(prepared.preparation).toMatchObject({
      state: 'queued',
      revision: 1,
      attempt: 0,
      input: { requirements }
    })
    const request = JSON.parse(prepared.preparation!.input.context) as Record<string, unknown>
    expect(request).toMatchObject({
      version: 1,
      ask: card.title,
      kind: card.type,
      context: card.context
    })
    expect(request.action).toEqual(
      card.action ? { name: card.action, args: card.actionArgs } : null
    )
    expect(store.inboxPreparations.listEligible(200).map((item) => item.id)).toEqual([card.id])
  })

  it('names the bundle it already has as the request source', () => {
    const { store, callAs } = setup()
    const card = legacy(store, { type: 'bug', action: null, actionArgs: null, details: DRAFTED })
    const prepared = callAs(
      { kind: 'paired-device', deviceId: 'p' },
      'pilot.inbox.prepareEvidence',
      { id: card.id }
    ) as InboxItemRow
    expect(JSON.parse(prepared.preparation!.input.context)).toMatchObject({
      sources: [{ role: 'initial_details', path: DRAFTED.path }]
    })
  })

  it.each<[string, RpcCallerIdentity | undefined]>([
    ['the local CLI', { kind: 'local-cli' }],
    ['an unknown caller', undefined]
  ])('refuses Prepare evidence from %s', (_who, caller) => {
    const { store, callAs } = setup()
    const card = legacy(store, {})
    expect(() => callAs(caller, 'pilot.inbox.prepareEvidence', { id: card.id })).toThrow(
      "Prepare evidence from Pilot's window or a paired device"
    )
    expect(store.inbox.get(card.id)?.preparation ?? null).toBeNull()
  })

  it.each<[string, Partial<NewInboxItem>]>([
    [
      'already prepared',
      { preparation: queuedPreparation({ key: 'k', context: 'c', requirements: ['context'] }, 1) }
    ],
    ['a card that needs no evidence', { type: 'question', action: null, actionArgs: null }]
  ])('refuses a card %s', (_what, over) => {
    const { store, callAs } = setup()
    const card = legacy(store, over)
    expect(() =>
      callAs({ kind: 'desktop' }, 'pilot.inbox.prepareEvidence', { id: card.id })
    ).toThrow('Only an open card that needs evidence and was never prepared can be prepared')
  })
})
