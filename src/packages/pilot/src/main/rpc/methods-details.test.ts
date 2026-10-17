import { createHash } from 'node:crypto'
import { mkdtempSync, readFileSync, realpathSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import type { RpcCallerIdentity } from '../../../../../main/runtime/rpc/rpc-caller-identity'
import { loadDefinitions } from '../definitions/loader'
import { copyBundle, detailsFixture, rewriteBundle } from '../inbox/__fixtures__/details-fixture'
import { completePreparation } from '../inbox/preparation'
import { ReviewFileSchema } from '../inbox/details-schema'
import { loadDetails } from '../inbox/details-bundle'
import { addInboxItem } from '../inbox/inbox-add'
import type { PilotHost } from '../pilot-services'
import { PilotStore } from '../store/store'
import { buildPilotMethods } from './methods'
import { answerRunEnded } from '../answers/answer-run-end'
import { ANSWER_LOCKED } from '../inbox/answer-lock'
import { redraftedReply } from '../../shared/pilot-replies'

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
  for (const id of ['ci', 'qa', 'prepare']) {
    writeFileSync(
      join(dir, `${id}.yaml`),
      `name: ${id}\nrepo: r\nschedule: manual\nitems: { kind: ${id === 'prepare' ? 'inbox_preparation' : 'merge_request'} }\nsteps: [ { agent: claude, prompt: x } ]\ninbox: nish\n`
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
  it('registers pilot.inbox.details, pilot.inbox.image and pilot.inbox.report as workspace methods', () => {
    const { find } = detailsSetup()
    for (const name of ['pilot.inbox.details', 'pilot.inbox.image', 'pilot.inbox.report']) {
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

  it("gives a report's checked real path, and refuses a file no report block names", () => {
    const { f, store, add, callAs } = detailsSetup()
    writeFileSync(join(f.dir, 'guide.html'), '<!doctype html><title>g</title>')
    rewriteBundle(f.bundle, (b) => b.blocks.push({ type: 'report', file: 'guide.html' }))
    const id = add(f.bundle)
    const digest = store.inbox.get(id)?.digest
    expect(callAs(DESKTOP, 'pilot.inbox.report', { id, digest, file: 'guide.html' })).toEqual({
      path: realpathSync(join(f.dir, 'guide.html'))
    })
    expect(() => callAs(DESKTOP, 'pilot.inbox.report', { id, digest, file: 'F2-qa.png' })).toThrow(
      /^Details bundle refused: report "F2-qa.png" is not a report/
    )
    expect(() =>
      callAs(undefined, 'pilot.inbox.report', { id, digest, file: 'guide.html' })
    ).toThrow("Pilot can't tell who is calling; nothing was read")
  })

  it.each([
    ['details', { file: undefined }],
    ['image', { file: 'F2-qa.png' }],
    ['report', { file: 'guide.html' }]
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

// apply.md step 5: the answer run that is applying a card's answer re-drafts it (Approve with notes, the branch
// moved) and re-attaches it. Its own dispatched answer is not in the way; another run's still is.
describe("a card's own answer run re-attaches its Details", () => {
  function answerRun(store: PilotStore, id: string, terminal: string): void {
    store.runs.create({
      id,
      automationId: 'ci',
      tickId: null,
      itemKey: 'mr:1',
      itemLabel: '!1',
      worktreePath: null,
      startedAt: 1,
      trigger: 'answer'
    })
    store.runs.createStep({
      runId: id,
      idx: 0,
      name: 'answers',
      agent: 'claude',
      skill: null,
      mode: null,
      startedAt: 1,
      status: 'running'
    })
    store.runs.updateStep(id, 0, { terminalHandle: terminal })
  }

  // A ci card answered and sent to <sentTo>, which is still running; ans-1 runs on term-a, ans-2 on term-b.
  function sentTo(sentTo: string) {
    const s = detailsSetup()
    answerRun(s.store, 'ans-1', 'term-a')
    answerRun(s.store, 'ans-2', 'term-b')
    const id = s.add(null)
    const digest = s.store.inbox.get(id)?.digest ?? ''
    s.store.inbox.saveAnswer(id, { option: 0, text: null, digest, via: 'page' }, 'nish', 110)
    const row = s.store.queue.enqueue(id, 200, 110)
    s.store.queue.update(row, { state: 'dispatched', readyAt: 120, dispatchedRunId: sentTo }, 120)
    const redraft = copyBundle(s.f, 'F2-v2.json')
    rewriteBundle(redraft, (b) => {
      b.blocks[0].rows = [['Applies', 'the re-drafted patch']]
    })
    return { ...s, id, redraft }
  }

  it('attaches from the running answer run, clears the answer and asks again', () => {
    const { f, store, id, redraft, callAs } = sentTo('ans-1')
    const params = { id, bundlePath: redraft, head: '1234abcd99', terminal: 'term-a' }
    expect(callAs(CLI, 'pilot.inbox.setDetails', params)).toEqual({
      id,
      version: 2,
      changed: true,
      cleared: true
    })
    expect(store.inbox.get(id)).toMatchObject({ status: 'open', answer: null, version: 2 })
    expect(store.inbox.get(id)?.replies.at(-1)).toEqual({
      text: redraftedReply('1234abcd99'),
      by: 'pilot'
    })
    expect(store.inbox.snapshot(id)?.ref.sha256).toBe(loadDetails(f.root, redraft).ref.sha256)
  })

  it('re-adds the card with its bundle from the running answer run, clearing the answer', () => {
    const { store, id, redraft, callAs } = sentTo('ans-1')
    const card = { type: 'bug', title: 'A ci card', detailsBundlePath: redraft, terminal: 'term-a' }
    expect(callAs(CLI, 'pilot.inbox.add', card)).toEqual({ id, existing: true, refused: null })
    expect(store.inbox.get(id)).toMatchObject({ status: 'open', answer: null, version: 2 })
  })

  it("still refuses set-details while another run's answer is being applied", () => {
    const { store, id, redraft, callAs } = sentTo('ans-2')
    const before = store.inbox.get(id)
    const params = { id, bundlePath: redraft, terminal: 'term-a' }
    expect(() => callAs(CLI, 'pilot.inbox.setDetails', params)).toThrow(ANSWER_LOCKED)
    expect(store.inbox.get(id)).toEqual(before)
  })

  it("still refuses a bundled re-add while another run's answer is being applied", () => {
    const { store, id, redraft, callAs } = sentTo('ans-2')
    const before = store.inbox.get(id)
    const card = { type: 'bug', title: 'A ci card', detailsBundlePath: redraft, terminal: 'term-a' }
    expect(callAs(CLI, 'pilot.inbox.add', card)).toEqual({
      id: null,
      existing: true,
      refused: ANSWER_LOCKED
    })
    expect(store.inbox.get(id)).toEqual(before)
  })

  it.each([
    [{ outcome: 'applied', item_status: 'done' }],
    [{ outcome: 're-drafted', item_status: 'open', reply: 'Re-drafted with your notes' }]
  ])('leaves the new version alone when the answer run then ends (%j)', (outputs) => {
    const { store, id, redraft, callAs } = sentTo('ans-1')
    callAs(CLI, 'pilot.inbox.setDetails', { id, bundlePath: redraft, terminal: 'term-a' })
    const reasked = store.inbox.get(id)
    store.runs.updateStep('ans-1', 0, { status: 'done', outputs })
    store.runs.update('ans-1', { status: 'done', finishedAt: 300 })
    answerRunEnded(store, store.runs.get('ans-1')!)
    expect(store.inbox.get(id)).toEqual(reasked)
  })
})

describe('managed preparation RPC scope and completion', () => {
  it('refuses a valid review preview that differs from the exact review the action will post', async () => {
    const { store, deps, f } = detailsSetup()
    const reviewPath = join(f.dir, 'sample-review.json')
    const original = readFileSync(reviewPath, 'utf8')
    const review = ReviewFileSchema.parse(JSON.parse(original))
    const digest = createHash('sha256').update(original).digest('hex')
    const id = addInboxItem(deps, {
      automationId: 'ci',
      itemKey: 'mr:1',
      type: 'action',
      title: 'Post review',
      action: 'post_review',
      actionArgs: { argv: [String(review.iid), reviewPath, digest] },
      parts: Object.fromEntries(review.parts.map((part) => [part.id, part.title])),
      preparation: {
        key: 'post',
        context: 'Review the exact comments',
        requirements: ['context', 'review']
      }
    }).id!
    store.inboxPreparations.claim(id, 1, 'worker', 0, 100)
    rewriteBundle(f.bundle, (bundle) => {
      bundle.provenance = {
        originatingRunId: null,
        preparingRunId: 'worker',
        itemId: id,
        attempt: 1
      }
      bundle.blocks = [
        { type: 'text', body: 'Exact comments for review' },
        { type: 'review', file: 'sample-review.json' }
      ]
    })
    const differentReview = {
      ...review,
      head_sha: 'f'.repeat(40),
      parts: review.parts.map((part) => ({ ...part, comment: 'Different comment' }))
    }
    writeFileSync(reviewPath, JSON.stringify(differentReview))
    await expect(
      completePreparation(
        deps,
        id,
        { runId: 'worker', stepIdx: 0, revision: 1, attempt: 1 },
        f.bundle
      )
    ).rejects.toThrow('review')
    expect(store.inbox.get(id)?.preparation?.state).toBe('generating')
    writeFileSync(reviewPath, original)
    expect(
      (
        await completePreparation(
          deps,
          id,
          { runId: 'worker', stepIdx: 0, revision: 1, attempt: 1 },
          f.bundle
        )
      )?.preparation?.state
    ).toBe('ready')
  })

  it('lets a scoped worker from another automation complete but rejects ordinary workers and late results', async () => {
    const { store, deps, f, callAs } = detailsSetup()
    const id = addInboxItem(deps, {
      automationId: 'ci',
      itemKey: 'mr:1',
      type: 'question',
      title: 'Decision',
      preparation: {
        key: 'decision',
        context: 'Investigate the pinned issue',
        requirements: ['context']
      }
    }).id!
    withRuns(store)
    store.runs.create({
      id: 'worker',
      automationId: 'prepare',
      tickId: null,
      itemKey: id,
      itemLabel: 'Decision',
      worktreePath: '/wt',
      startedAt: 1
    })
    store.runs.createStep({
      runId: 'worker',
      idx: 0,
      name: 'prepare',
      agent: 'claude',
      skill: null,
      mode: null,
      startedAt: 1,
      status: 'running'
    })
    store.inboxPreparations.claim(id, 1, 'worker', 0, Date.now())
    const params = { id, revision: 1, attempt: 1, runId: 'worker', stepIdx: 0 }
    expect(() =>
      callAs(CLI, 'pilot.inbox.prepareProgress', { ...params, runId: 'run-1', message: 'Bypass' })
    ).toThrow('no grant')
    expect(() =>
      callAs(DESKTOP, 'pilot.inbox.prepareProgress', { ...params, message: 'Bypass' })
    ).toThrow('active Pilot worker')
    expect(callAs(CLI, 'pilot.inbox.prepareClaim', params)).toMatchObject({
      automationId: 'ci',
      preparation: { attempt: 1 }
    })
    rewriteBundle(f.bundle, (bundle) => {
      bundle.provenance = {
        originatingRunId: null,
        preparingRunId: 'worker',
        itemId: id,
        attempt: 1
      }
      bundle.blocks = [{ type: 'text', body: 'Investigated context' }]
    })
    expect(
      await callAs(CLI, 'pilot.inbox.prepareComplete', { ...params, bundlePath: f.bundle })
    ).toMatchObject({
      preparation: { state: 'ready' },
      details: { artifacts: { expected: ['context'] } }
    })
    await expect(
      callAs(CLI, 'pilot.inbox.prepareComplete', { ...params, bundlePath: f.bundle })
    ).rejects.toThrow('stale')
  })
  it('keeps required evidence pending after validation fails and refuses completion after an early answer', async () => {
    const { store, deps, f, callAs } = detailsSetup()
    const id = addInboxItem(deps, {
      automationId: 'ci',
      itemKey: 'mr:1',
      type: 'question',
      title: 'Decision',
      preparation: {
        key: 'decision',
        context: 'Investigate pinned issue',
        requirements: ['context', 'screens']
      }
    }).id!
    store.runs.create({
      id: 'worker',
      automationId: 'prepare',
      tickId: null,
      itemKey: id,
      itemLabel: 'Decision',
      worktreePath: '/wt',
      startedAt: 1
    })
    store.runs.createStep({
      runId: 'worker',
      idx: 0,
      name: 'prepare',
      agent: 'claude',
      skill: null,
      mode: null,
      startedAt: 1,
      status: 'running'
    })
    store.inboxPreparations.claim(id, 1, 'worker', 0, Date.now())
    const params = {
      id,
      revision: 1,
      attempt: 1,
      runId: 'worker',
      stepIdx: 0,
      bundlePath: f.bundle
    }
    rewriteBundle(f.bundle, (bundle) => {
      bundle.provenance = {
        originatingRunId: null,
        preparingRunId: 'worker',
        itemId: id,
        attempt: 1
      }
      bundle.blocks = [{ type: 'text', body: 'Evidence gathered' }]
    })
    await expect(callAs(CLI, 'pilot.inbox.prepareComplete', params)).rejects.toThrow(
      'Required screens'
    )
    expect(store.inbox.get(id)).toMatchObject({
      details: null,
      preparation: { state: 'generating' }
    })
    const item = store.inbox.get(id)!
    store.inbox.saveAnswer(
      id,
      { digest: item.digest, text: 'Skip', option: null, via: 'page' },
      'nish',
      Date.now()
    )
    await expect(callAs(CLI, 'pilot.inbox.prepareComplete', params)).rejects.toThrow('stale')
    expect(store.inbox.get(id)).toMatchObject({ status: 'answered', details: null })
  })
})

// M2: a person retries a blocked preparation from Pilot's window or a paired device; nothing else may requeue it.
describe('pilot.inbox.prepareRetry', () => {
  const PAIRED: RpcCallerIdentity = { kind: 'paired-device', deviceId: 'phone' }
  function managed(state: 'blocked' | 'queued' | 'generating' | 'ready' | 'cancelled' | null) {
    const s = detailsSetup()
    const id = addInboxItem(s.deps, {
      automationId: 'ci',
      itemKey: 'mr:1',
      type: 'bug',
      title: 'Proposed fix',
      ...(state
        ? { preparation: { key: 'k', context: 'Pinned', requirements: ['context' as const] } }
        : {})
    }).id!
    const prep = s.store.inbox.get(id)?.preparation
    if (prep && state && state !== 'queued') {
      s.store.inboxPreparations.write(id, { ...prep, state, attempt: 3, error: 'No screenshot' })
    }
    return { ...s, id }
  }

  it.each([
    ['the desktop', DESKTOP],
    ['a paired device', PAIRED]
  ] as const)('lets %s put a blocked card back in the queue, attempts reset', (_who, caller) => {
    const { callAs, store, id } = managed('blocked')
    expect(callAs(caller, 'pilot.inbox.prepareRetry', { id })).toMatchObject({
      id,
      preparation: { state: 'queued', revision: 2, attempt: 0, error: null }
    })
    expect(store.inboxPreparations.listEligible(200).map((item) => item.id)).toEqual([id])
  })

  it.each([
    ['the local CLI (any agent)', CLI],
    ['an unknown caller', undefined]
  ] as const)('refuses %s', (_who, caller) => {
    const { callAs, store, id } = managed('blocked')
    expect(() => callAs(caller, 'pilot.inbox.prepareRetry', { id })).toThrow(
      "Retry preparation from Pilot's window or a paired device"
    )
    expect(store.inbox.get(id)?.preparation).toMatchObject({ state: 'blocked', revision: 1 })
  })

  it.each(['queued', 'generating', 'ready', 'cancelled', null] as const)(
    'refuses a card whose preparation is %s',
    (state) => {
      const { callAs, store, id } = managed(state)
      const before = store.inbox.get(id)?.preparation ?? null
      expect(() => callAs(DESKTOP, 'pilot.inbox.prepareRetry', { id })).toThrow(
        'Only a blocked preparation can be retried'
      )
      expect(store.inbox.get(id)?.preparation ?? null).toEqual(before)
    }
  )
})
