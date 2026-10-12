import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { parseAutomationYaml } from '../../shared/definition/parse'
import { parsePeopleYaml } from '../../shared/people'
import { routeOf } from '../answers/queue-view'
import { PilotStore } from '../store/store'
import { applyVaultImport, SENT_BEFORE_PILOT } from './import-apply'
import { addInboxItem } from './inbox-add'
import { splitCommand } from './split-command'
import { planVaultImport, vaultItemId, type ImportContext } from './import-vault'
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

  it("pins a push card's catalog action and arguments, and keeps an unknown script's card for the agent", () => {
    const plan = planVaultImport(
      [
        row({ ...PUSH_ROW, key: 'a'.repeat(16) }),
        row({
          ...PUSH_ROW,
          key: 'b'.repeat(16),
          summary: 'Remove?',
          run_command: 'remove-worktree /wt/x abc'
        })
      ],
      ctx()
    )
    expect(plan.items.map((i) => [i.params.action, i.params.actionArgs])).toEqual([
      ['push', { argv: ['/wt/a b', 'web-1', 'aaa', 'bbb'] }],
      [undefined, undefined]
    ])
    expect(plan.notes).toEqual([
      {
        id: vaultItemId(NOTE, 'b'.repeat(16)),
        note: "remove-worktree isn't in Pilot's catalog: Approve goes to the agent"
      }
    ])
  })

  it('makes the asking session an imported run the dispatcher can fork', () => {
    const plan = planVaultImport([row({}), row({ key: 'c'.repeat(16), summary: 'Second?' })], ctx())
    expect(plan.runs).toHaveLength(1)
    expect(plan.runs[0]).toMatchObject({
      automationId: 'fix-failed-ci',
      agent: 'claude',
      sessionId: '1b2c3d4e-0000-4000-8000-00000000abcd',
      itemKey: 'mr:1214',
      itemLabel: '!1214 web-1-x'
    })
    expect(plan.items.map((i) => i.params.runId)).toEqual([plan.runs[0].id, plan.runs[0].id])
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
