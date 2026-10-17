import { mkdtempSync, realpathSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { parseAutomationYaml } from '../../shared/definition/parse'
import { parsePeopleYaml } from '../../shared/people'
import { routeOf } from '../answers/queue-view'
import { PilotStore } from '../store/store'
import { NEEDS_EVIDENCE } from '../../shared/evidence'
import { saveAnswer } from '../answers/save'
import { applyVaultImport, SENT_BEFORE_PILOT } from './import-apply'
import { listInbox } from './inbox-service'
import { addInboxItem } from './inbox-add'
import { splitCommand } from './split-command'
import { copyBundle, detailsFixture, rewriteBundle } from './__fixtures__/details-fixture'
import { setInboxDetails } from './inbox-details'
import {
  isBackfillable,
  isDatable,
  planVaultImport,
  vaultItemId,
  type ImportContext
} from './import-vault'
import type { InboxDeps } from './inbox-service'
import type { VaultRow } from './vault-reader'

const def = parseAutomationYaml(
  'name: Fix failed CI on my MRs\nrepo: web-platform\nschedule: manual\nitems: { kind: merge_request }\nsteps: [ { agent: claude, prompt: x } ]\ninbox: nish\n',
  '/a/fix-failed-ci.yaml'
)
const people = parsePeopleYaml('people:\n  - { id: nish, name: Nish }\n')
if (!def.ok || !people.ok) {
  throw new Error('setup')
}
const NOTE = '/v/Agent Work/Automations/05 · Fix failed CI on my MRs/web-1-x.md'
const KEY = '0123456789abcdef'
const catalog = { get: (name: string) => (name === 'push' ? {} : null) }

function row(over: Partial<VaultRow>): VaultRow {
  return {
    note: NOTE,
    key: KEY,
    kind: 'question',
    family: 'question',
    summary: 'Which?',
    location: 'web-1-x',
    context: 'Both work.',
    suggested: 'A',
    options: [
      { label: 'A', description: 'fast' },
      { label: 'B', description: '' }
    ],
    run_command: '',
    parts: [],
    switch: [],
    details: '',
    details_path: '',
    digest: 'd'.repeat(32),
    answer: '',
    replies: [],
    status: 'waiting',
    resume: 'claude --resume 1b2c3d4e-0000-4000-8000-00000000abcd',
    session: '1b2c3d4e-0000-4000-8000-00000000abcd',
    asked_in: '05a-20261010T0612',
    section_time: '2026-10-10 06:12',
    created_at: '2026-10-10T06:12:00-07:00',
    worktree: '/wt/web-1-x',
    mr_iid: 1214,
    job: '05 · Fix failed CI on my MRs',
    job_code: '05',
    skill: 'ci-fix-sweep',
    scope: 'branch',
    branch: 'web-1-x',
    bound: false,
    ...over
  }
}
const ctx = (existing: (id: string) => boolean = () => false): ImportContext => ({
  definitions: [def.ok ? def.definition : (null as never)],
  people: people.ok ? people.directory : (null as never),
  worktreeIds: new Map(),
  existing,
  now: 1_000
})
function open() {
  const store = PilotStore.open(join(mkdtempSync(join(tmpdir(), 'pilot-import-')), 'db.sqlite'))
  const deps: InboxDeps = {
    store,
    now: () => 1_000,
    definitions: () => [def.ok ? def.definition : (null as never)],
    people: () => (people.ok ? people.directory : (null as never)),
    knownAction: (name) => catalog.get(name) !== null,
    actionArgsProblem: (_name, args) => (Array.isArray(args.argv) ? null : 'usage: push …')
  }
  return { store, deps }
}
const PUSH_ROW = {
  kind: 'action' as const,
  family: 'action' as const,
  run_command: "push '/wt/a b' web-1 aaa bbb"
}

describe('splitCommand', () => {
  it.each([
    ["push '/wt/a b' web-1 aaa bbb", ['push', '/wt/a b', 'web-1', 'aaa', 'bbb']],
    ['post-review 1579 "f x.json" abc', ['post-review', '1579', 'f x.json', 'abc']],
    ['mark-ready 12 a\\ b', ['mark-ready', '12', 'a b']]
  ])('%s', (text, expected) => expect(splitCommand(text)).toEqual(expected))
})

describe('planVaultImport', () => {
  it('maps a waiting question onto its automation, MR and worktree', () => {
    const plan = planVaultImport([row({})], ctx())
    expect(plan.items[0]).toMatchObject({
      id: vaultItemId(NOTE, KEY),
      automationId: 'fix-failed-ci',
      itemKey: 'mr:1214',
      worktreePath: '/wt/web-1-x',
      type: 'question',
      title: 'Which?',
      vaultRef: `${NOTE}#${KEY}`,
      answer: null
    })
    expect(plan.items[0].params.options).toEqual(['A — fast', 'B'])
  })

  it.each<[string, Partial<VaultRow>, unknown]>([
    [
      'a page approval of this card',
      { ...PUSH_ROW, answer: 'approve', status: 'answered', bound: 'd'.repeat(32) },
      { text: 'approve', via: 'page', sent: false }
    ],
    [
      'an answer typed into the note',
      { answer: 'A', status: 'answered' },
      { text: 'A', via: 'import', option: 0, sent: false }
    ],
    [
      'an answer apply.py already sent',
      { answer: 'A', status: 'applying' },
      { text: 'A', via: 'import', sent: true }
    ]
  ])('keeps %s', (_name, over, answer) => {
    expect(planVaultImport([row(over)], ctx()).items[0].answer).toMatchObject(answer as object)
  })

  // post-review left the catalog (review-mr posts nothing since 2026-10-16): an old Post card imports as any unknown
  // script's does.
  it("pins a push card's catalog action and arguments, and keeps an unknown script's card for the agent", () => {
    const plan = planVaultImport(
      [
        row({ ...PUSH_ROW, key: 'a'.repeat(16) }),
        row({
          ...PUSH_ROW,
          key: 'b'.repeat(16),
          summary: 'Remove?',
          run_command: 'remove-worktree /wt/x abc'
        }),
        row({
          ...PUSH_ROW,
          key: 'c'.repeat(16),
          summary: 'Post?',
          run_command: 'post-review 1579 r.json abc'
        })
      ],
      ctx()
    )
    expect(plan.items.map((i) => [i.params.action, i.params.actionArgs])).toEqual([
      ['push', { argv: ['/wt/a b', 'web-1', 'aaa', 'bbb'] }],
      [undefined, undefined],
      [undefined, undefined]
    ])
    expect(plan.notes).toEqual([
      {
        id: vaultItemId(NOTE, 'b'.repeat(16)),
        note: "remove-worktree isn't in Pilot's catalog: Approve goes to the agent"
      },
      {
        id: vaultItemId(NOTE, 'c'.repeat(16)),
        note: "post-review isn't in Pilot's catalog: Approve goes to the agent"
      }
    ])
  })

  it('makes the asking session an imported run the dispatcher can fork', () => {
    const plan = planVaultImport([row({}), row({ key: 'c'.repeat(16), summary: 'Second?' })], ctx())
    expect(plan.runs).toHaveLength(1)
    expect(plan.runs[0]).toMatchObject({
      automationId: 'fix-failed-ci',
      agent: 'claude',
      skill: 'ci-fix-sweep',
      sessionId: '1b2c3d4e-0000-4000-8000-00000000abcd',
      itemKey: 'mr:1214'
    })
    expect(plan.items.map((i) => i.params.runId)).toEqual([plan.runs[0].id, plan.runs[0].id])
  })

  // A run holds every card of its note's section, so its name never comes from one card's location.
  it.each<[string, Partial<VaultRow>, string]>([
    ['an MR card by its MR and branch', {}, '!1214 web-1-x'],
    [
      'a branch card without an MR by its branch',
      { mr_iid: null, location: 'Not established' },
      'web-1-x'
    ],
    [
      'a job card by its automation',
      { scope: 'job', branch: '', worktree: null, mr_iid: null, location: 'Not established' },
      'Fix failed CI on my MRs'
    ]
  ])('names the imported run of %s', (_, over, label) => {
    expect(planVaultImport([row(over)], ctx()).runs[0]?.itemLabel).toBe(label)
  })

  it.each<[string, Partial<VaultRow>, (id: string) => boolean, string]>([
    [
      'a job with no YAML automation yet',
      { job: '03 · Review and fix branch code' },
      () => false,
      'no Pilot automation is named after "03 · Review and fix branch code"'
    ],
    ['a card imported before', {}, () => true, 'already imported']
  ])('skips %s', (_name, over, existing, reason) => {
    const plan = planVaultImport([row(over)], ctx(existing))
    expect(plan.items).toEqual([])
    expect(plan.skipped).toMatchObject([{ reason }])
  })
})

describe('applyVaultImport', () => {
  it('writes the items, their queue rows and the asking runs, once', () => {
    const { store, deps } = open()
    const rows = [
      row({ answer: 'A', status: 'answered' }),
      row({ key: 'c'.repeat(16), summary: 'Second?' })
    ]
    const plan = planVaultImport(rows, ctx())
    const report = applyVaultImport(deps, plan, 1_000)
    expect(report).toMatchObject({ applied: true, imported: 2, answers: 1, runs: 1, skipped: [] })
    const run = store.runs.get(plan.runs[0].id)
    expect(run).toMatchObject({ status: 'needs_you', trigger: 'import', imported: true })
    expect(store.runs.steps(run!.id)[0]).toMatchObject({
      status: 'done',
      sessionId: '1b2c3d4e-0000-4000-8000-00000000abcd',
      agent: 'claude'
    })
    const id = vaultItemId(NOTE, KEY)
    expect(store.queue.forInboxItem(id)).toMatchObject([
      { state: 'not_ready', readyAt: 1_000 + 180_000 }
    ])
    expect(store.inbox.get(id)).toMatchObject({
      status: 'answered',
      source: 'import',
      vaultRef: `${NOTE}#${KEY}`,
      person: 'nish',
      itemKey: 'mr:1214',
      worktreePath: '/wt/web-1-x',
      answer: { text: 'A', via: 'import', option: 0 }
    })
    expect(store.inbox.get(id)?.answer?.callerKind).toBeUndefined()
  })

  it('imports nothing the second time', () => {
    const { store, deps } = open()
    const rows = [
      row({ answer: 'A', status: 'answered' }),
      row({ key: 'c'.repeat(16), summary: 'Second?' })
    ]
    applyVaultImport(deps, planVaultImport(rows, ctx()), 1_000)
    const again = planVaultImport(
      rows,
      ctx((id) => store.inbox.get(id) !== null)
    )
    expect(applyVaultImport(deps, again, 2_000)).toMatchObject({ imported: 0, runs: 0 })
    expect(store.inbox.list({ automationId: 'fix-failed-ci' })).toHaveLength(2)
  })

  it('keeps an answer apply.py already sent as dispatched', () => {
    const { store, deps } = open()
    applyVaultImport(
      deps,
      planVaultImport([row({ answer: 'A', status: 'applying' })], ctx()),
      1_000
    )
    expect(store.queue.forInboxItem(vaultItemId(NOTE, KEY))).toMatchObject([
      { state: 'dispatched', route: null }
    ])
  })

  it('re-asks an imported approval for Nish to confirm in Pilot, and runs nothing', () => {
    const { store, deps } = open()
    const approved = row({
      ...PUSH_ROW,
      answer: 'approve',
      status: 'answered',
      bound: 'd'.repeat(32)
    })
    applyVaultImport(deps, planVaultImport([approved], ctx()), 1_000)
    const item = store.inbox.get(vaultItemId(NOTE, KEY))!
    expect(item).toMatchObject({ action: 'push', answer: { text: 'approve', via: 'page' } })
    expect(routeOf(item, catalog)).toEqual({
      kind: 'reask',
      reason: 'Approve actions in Pilot on this Mac'
    })
    expect(store.queue.forInboxItem(item.id)).toMatchObject([{ state: 'not_ready' }])
  })

  it("applies the engine's card rules: an over-limit card is skipped with the reason, not written", () => {
    const { store, deps } = open()
    const options = Array.from({ length: 11 }, (_, i) => ({ label: `o${i}`, description: '' }))
    const report = applyVaultImport(deps, planVaultImport([row({ options })], ctx()), 1_000)
    expect(report.skipped).toMatchObject([{ reason: 'A card can have at most 10 options' }])
    expect(report).toMatchObject({ imported: 0 })
    expect(store.inbox.get(vaultItemId(NOTE, KEY))).toBeNull()
  })
})

describe('applyVaultImport: what it must not disturb or lose', () => {
  const second = { key: 'c'.repeat(16) }

  it('leaves a same-titled open engine card untouched and skips the vault card, every run', () => {
    const { store, deps } = open()
    const engine = addInboxItem(
      { ...deps, newId: () => 'in_engine00000001' },
      {
        automationId: 'fix-failed-ci',
        itemKey: 'mr:1214',
        type: 'question',
        title: 'Which?',
        options: ['X', 'Y']
      }
    )
    store.inbox.update(
      'in_engine00000001',
      { status: 'answered', answer: { option: 0, text: 'X', digest: 'x', via: 'page' } },
      1
    )
    const before = store.inbox.get(engine.id!)
    for (let i = 0; i < 2; i += 1) {
      const report = applyVaultImport(
        deps,
        planVaultImport([row({ session: '', worktree: null })], ctx()),
        1_000 + i
      )
      expect(report).toMatchObject({ imported: 0, skipped: [{ reason: 'same card already open' }] })
    }
    expect(store.inbox.get(engine.id!)).toEqual(before)
  })

  it('skips the second of two vault cards sharing a title, and keeps the first answer', () => {
    const { store, deps } = open()
    const rows = [
      row({ answer: 'A', status: 'answered' }),
      row({ ...second, answer: 'B', status: 'answered' })
    ]
    const plan = planVaultImport(rows, ctx())
    expect(plan.skipped).toMatchObject([{ key: second.key, reason: 'same card already open' }])
    applyVaultImport(deps, plan, 1_000)
    expect(store.inbox.get(vaultItemId(NOTE, KEY))?.answer).toMatchObject({ text: 'A' })
  })

  it('writes the card and its answer together: the answer_saved event; nobody is left waiting on the run', () => {
    const { store, deps } = open()
    const plan = planVaultImport([row({ answer: 'A', status: 'answered' })], ctx())
    applyVaultImport(deps, plan, 1_000)
    expect(store.events.list({ kinds: ['answer_saved'] })).toHaveLength(1)
    expect(store.runs.get(plan.runs[0].id)?.status).toBe('done')
  })

  it('makes no run for a card that is skipped', () => {
    const { store, deps } = open()
    const options = Array.from({ length: 11 }, (_, i) => ({ label: `o${i}`, description: '' }))
    const plan = planVaultImport([row({ options })], ctx())
    expect(applyVaultImport(deps, plan, 1_000)).toMatchObject({ imported: 0, runs: 0 })
    expect(store.runs.get(plan.runs[0].id)).toBeNull()
  })

  it('a dry run counts only what apply would add, and writes nothing', () => {
    const { store, deps } = open()
    const options = Array.from({ length: 11 }, (_, i) => ({ label: `o${i}`, description: '' }))
    const plan = planVaultImport(
      [row({ options }), row({ key: 'e'.repeat(16), summary: 'Fine?' })],
      ctx()
    )
    expect(applyVaultImport(deps, plan, 1_000, { dryRun: true })).toMatchObject({
      applied: false,
      imported: 1,
      runs: 1,
      skipped: [{ reason: 'A card can have at most 10 options' }]
    })
    expect(store.inbox.list({})).toEqual([])
    expect(store.runs.get(plan.runs[0].id)).toBeNull()
  })

  it('marks a card whose answer apply.py already sent, so Nish can tick it', () => {
    const { store, deps } = open()
    applyVaultImport(
      deps,
      planVaultImport([row({ answer: 'A', status: 'applying' })], ctx()),
      1_000
    )
    expect(store.inbox.get(vaultItemId(NOTE, KEY))?.replies).toEqual([
      { text: SENT_BEFORE_PILOT, by: 'pilot' }
    ])
  })

  it('files a sessionless branch card with an unknown worktree job-wide, without it, in a dry run and for real', () => {
    const { store, deps } = open()
    const plan = planVaultImport([row({ session: '' })], ctx())
    expect(plan.items[0].params).toMatchObject({ worktreePath: '/wt/web-1-x', itemKey: 'mr:1214' })
    expect(applyVaultImport(deps, plan, 1_000, { dryRun: true })).toMatchObject({
      imported: 1,
      skipped: []
    })
    expect(applyVaultImport(deps, plan, 1_000)).toMatchObject({ imported: 1, skipped: [] })
    expect(store.inbox.get(vaultItemId(NOTE, KEY))).toMatchObject({
      worktreePath: null,
      itemKey: 'mr:1214',
      source: 'import'
    })
  })
})

describe('the asking session', () => {
  it.each(['1b2c3d4e-0000', '--dangerously-skip-permissions', 'abc; rm -rf /'])(
    'does not trust %s as a session id: the card is job-wide, with no run',
    (session) => {
      const plan = planVaultImport([row({ session })], ctx())
      expect(plan.runs).toEqual([])
      expect(plan.items[0].params).toMatchObject({ automationId: 'fix-failed-ci' })
      expect(plan.items[0].params.runId).toBeUndefined()
    }
  )
})

describe('the vault import and Details bundles', () => {
  const ID = vaultItemId(NOTE, KEY)
  function withDetails() {
    const f = detailsFixture()
    const { store, deps } = open()
    const full: InboxDeps = { ...deps, detailsRoot: f.root }
    const plan = (rows: VaultRow[]) =>
      planVaultImport(rows, {
        ...ctx((id) => store.inbox.get(id) !== null),
        backfillable: (id) => isBackfillable(store.inbox.get(id))
      })
    // A card the import wrote before it carried bundles: the bundle's path as markdown.
    const imported = () =>
      addInboxItem(
        { ...full, newId: () => ID },
        {
          automationId: 'fix-failed-ci',
          itemKey: 'mr:1214',
          type: 'question',
          title: 'Which?',
          detailsMd: `Details bundle: ${f.bundle}`
        },
        { source: 'import', vaultRef: `${NOTE}#${KEY}` }
      )
    return { f, store, deps: full, plan, imported }
  }

  it('gives a new card its bundle, not the path as markdown', () => {
    const { f, store, deps, plan } = withDetails()
    const planned = plan([row({ details_path: f.bundle })])
    expect(planned.items[0].params).toMatchObject({ detailsBundlePath: f.bundle })
    expect(planned.items[0].params.detailsMd).toBeUndefined()
    expect(applyVaultImport(deps, planned, 1_000, { dryRun: true })).toMatchObject({
      imported: 1,
      details: 1,
      backfilled: 0
    })
    expect(applyVaultImport(deps, planned, 1_000)).toMatchObject({ imported: 1, details: 1 })
    expect(store.inbox.get(ID)).toMatchObject({ detailsMd: null })
    expect(store.inbox.get(ID)?.details?.path).toBe(realpathSync(f.bundle))
    expect(store.inbox.snapshot(ID)?.ref.blocks).toBe(8)
  })

  it.each([true, false])(
    'imports a card whose bundle is refused without it, saying why (dry run %s)',
    (dryRun) => {
      const { f, store, deps, plan } = withDetails()
      writeFileSync(f.bundle, '{"version": 2}')
      const report = applyVaultImport(deps, plan([row({ details_path: f.bundle })]), 1_000, {
        dryRun
      })
      expect(report).toMatchObject({ imported: 1, details: 0, skipped: [] })
      expect(report.notes).toEqual([
        { id: ID, note: expect.stringMatching(/^Details not attached: the bundle .* version/) }
      ])
      if (!dryRun) {
        expect(store.inbox.get(ID)).toMatchObject({ details: null })
        expect(store.inbox.get(ID)?.detailsMd).toMatch(
          new RegExp(`^Details bundle: ${f.bundle} \\(not shown in Pilot: the bundle .*\\)$`)
        )
      }
    }
  )

  it('fills the bundle into an open, unanswered card it imported before: previewed, then applied', () => {
    const { f, store, deps, plan, imported } = withDetails()
    imported()
    const planned = plan([row({ details_path: f.bundle })])
    expect(planned.items).toEqual([])
    expect(planned.backfill).toEqual([
      { id: ID, vaultRef: `${NOTE}#${KEY}`, title: 'Which?', path: f.bundle }
    ])
    expect(applyVaultImport(deps, planned, 1_000, { dryRun: true })).toMatchObject({
      imported: 0,
      backfilled: 1,
      details: 1,
      skipped: []
    })
    expect(store.inbox.get(ID)).toMatchObject({ version: 1, details: null })
    expect(applyVaultImport(deps, planned, 1_000)).toMatchObject({ backfilled: 1, details: 1 })
    expect(store.inbox.get(ID)).toMatchObject({ version: 2, detailsMd: null })
    expect(store.inbox.get(ID)?.details?.path).toBe(realpathSync(f.bundle))
    expect(plan([row({ details_path: f.bundle })])).toMatchObject({
      backfill: [],
      skipped: [{ reason: 'already imported' }]
    })
  })

  it('never touches an answered card', () => {
    const { f, store, plan, imported } = withDetails()
    imported()
    const digest = store.inbox.get(ID)?.digest ?? ''
    store.inbox.saveAnswer(ID, { option: 0, text: null, digest, via: 'page' }, 'nish', 1_100)
    expect(plan([row({ details_path: f.bundle })])).toMatchObject({
      backfill: [],
      skipped: [{ reason: 'already imported' }]
    })
  })

  it('keeps a bundle a draft attached between the preview and the apply', () => {
    const { f, store, deps, plan, imported } = withDetails()
    imported()
    const planned = plan([row({ details_path: f.bundle })])
    const drafted = copyBundle(f, 'F3.json')
    rewriteBundle(drafted, (b) => (b.item = 'F3'))
    setInboxDetails(deps, ID, drafted, { head: null, onlyUnanswered: false })
    const before = store.inbox.get(ID)
    const report = applyVaultImport(deps, planned, 1_000)
    expect(report).toMatchObject({ backfilled: 0, details: 0 })
    expect(report.skipped).toEqual([
      expect.objectContaining({
        reason: expect.stringMatching(/^Details not attached: has Details since/)
      })
    ])
    expect(store.inbox.get(ID)).toEqual(before)
    expect(store.inbox.snapshot(ID)?.bundle.item).toBe('F3')
  })

  it('leaves a card answered between the preview and the apply as it is', () => {
    const { f, store, deps, plan, imported } = withDetails()
    imported()
    const planned = plan([row({ details_path: f.bundle })])
    const digest = store.inbox.get(ID)?.digest ?? ''
    store.inbox.saveAnswer(ID, { option: 0, text: null, digest, via: 'page' }, 'nish', 1_100)
    const before = store.inbox.get(ID)
    const report = applyVaultImport(deps, planned, 1_000)
    expect(report).toMatchObject({ backfilled: 0, details: 0 })
    expect(report.skipped).toEqual([
      {
        note: NOTE,
        key: KEY,
        summary: 'Which?',
        reason: expect.stringMatching(/^Details not attached: answered since/)
      }
    ])
    expect(store.inbox.get(ID)).toEqual(before)
  })
})

describe('the ask date of an imported card', () => {
  const ASKED = Date.parse('2026-10-10T06:12:00-07:00')
  const SECTION = Date.parse('2026-10-10 06:12')
  const datable = (store: ReturnType<typeof open>['store']) => (id: string) => {
    const item = store.inbox.get(id)
    return item !== null && isDatable(item, ASKED)
  }
  const planWith = (store: ReturnType<typeof open>['store'], rows: VaultRow[]) =>
    planVaultImport(rows, {
      ...ctx((id) => store.inbox.get(id) !== null),
      backfillable: () => false,
      datable: (id, at) => {
        const item = store.inbox.get(id)
        return item !== null && isDatable(item, at)
      }
    })

  it.each([
    ['the vault row’s created_at', {}, ASKED],
    ['the section time when created_at is missing', { created_at: null }, SECTION],
    ['the import time when the row has neither', { created_at: null, section_time: '' }, 1_000]
  ])('a new import takes the ask date from %s', (_n, over, want) => {
    const { store, deps } = open()
    applyVaultImport(deps, planVaultImport([row(over)], ctx()), 1_000)
    expect(store.inbox.get(vaultItemId(NOTE, KEY))?.createdAt).toBe(want)
  })

  it('corrects only open imported cards whose time is later, once, leaving answers and digests alone', () => {
    const { store, deps } = open()
    const KEY2 = 'c'.repeat(16)
    const rows = [row({}), row({ key: KEY2, summary: 'Second?', answer: 'A', status: 'answered' })]
    // The 25-card state: imported at 9:01 on the 12th, not asked then.
    applyVaultImport(deps, planVaultImport(rows, ctx()), Date.parse('2026-10-12T09:01:00-07:00'))
    const open1 = vaultItemId(NOTE, KEY)
    const answered = vaultItemId(NOTE, KEY2)
    for (const id of [open1, answered]) {
      store.inbox.setCreatedAt(id, Date.parse('2026-10-12T09:01:00-07:00'))
    }
    const before = { open: store.inbox.get(open1), answered: store.inbox.get(answered) }

    const preview = applyVaultImport(deps, planWith(store, rows), 5_000, { dryRun: true })
    expect(preview).toMatchObject({ dates: 1, applied: false })
    expect(store.inbox.get(open1)?.createdAt).toBe(before.open?.createdAt)

    const report = applyVaultImport(deps, planWith(store, rows), 5_000)
    expect(report).toMatchObject({ dates: 1, applied: true, imported: 0 })
    expect(store.inbox.get(open1)).toEqual({ ...before.open, createdAt: ASKED })
    expect(store.inbox.get(answered)).toEqual(before.answered)

    expect(applyVaultImport(deps, planWith(store, rows), 6_000, { dryRun: true })).toMatchObject({
      dates: 0
    })
    expect(store.inbox.get(open1)?.createdAt).toBe(ASKED)
    expect(datable(store)(open1)).toBe(false)
  })

  it('is not part of the digest', () => {
    const a = open()
    const b = open()
    applyVaultImport(a.deps, planVaultImport([row({})], ctx()), 1_000)
    applyVaultImport(
      b.deps,
      planVaultImport([row({ created_at: '2026-01-01T00:00:00Z' })], ctx()),
      9_000
    )
    const id = vaultItemId(NOTE, KEY)
    expect(a.store.inbox.get(id)?.createdAt).not.toBe(b.store.inbox.get(id)?.createdAt)
    expect(a.store.inbox.get(id)?.digest).toBe(b.store.inbox.get(id)?.digest)
  })
})

// R-P5: an imported push (or Post, or drafted) card comes in as it was, unprepared, the same with or without its
// asking session. It shows Needs evidence, and nothing runs from it until a person prepares it.
describe('an imported card whose decision needs evidence', () => {
  it.each<[string, Partial<VaultRow>]>([
    ['with its asking session (a run)', {}],
    ['without one (job-wide)', { session: '', resume: '', worktree: null }]
  ])('imports %s as a card that needs evidence and runs nothing', (_name, over) => {
    const { store, deps } = open()
    const result = applyVaultImport(
      deps,
      planVaultImport([row({ ...PUSH_ROW, ...over })], ctx()),
      1_000
    )
    expect(result).toMatchObject({ imported: 1 })
    const item = store.inbox.get(vaultItemId(NOTE, KEY))!
    expect(item).toMatchObject({ action: 'push', source: 'import' })
    expect(item.preparation ?? null).toBeNull()
    expect(listInbox(deps, {}).items).toMatchObject([{ id: item.id, needsEvidence: true }])
    const origin = { callerKind: 'desktop' as const, catalog }
    expect(() =>
      saveAnswer(deps, { id: item.id, digest: item.digest, text: 'Approve' }, origin)
    ).toThrow(NEEDS_EVIDENCE)
  })
})
