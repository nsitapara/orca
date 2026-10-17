import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import type { ItemDecision } from '../../shared/api-types'
import type { AutomationDefinition } from '../../shared/definition/types'
import { parseAutomationYaml } from '../../shared/definition/parse'
import { parsePeopleYaml } from '../../shared/people'
import { argsDigest } from '../actions/powers'
import { attemptAction } from '../actions/attempt'
import { startRunEntry } from '../actions/start-run-entry'
import type { ActionCatalog } from '../actions/types'
import { addInboxItem } from '../inbox/inbox-add'
import { resolveInboxItem } from '../inbox/inbox-service'
import { PilotStore } from '../store/store'
import {
  askDecisions,
  askFirstCard,
  cancelUnstartedRun,
  runAnswerOf,
  runChoiceOf,
  type AskDeps
} from './ask-first'

const parsed = parseAutomationYaml(
  [
    'name: Prepare reviews requested of me',
    'repo: web-platform',
    'schedule: manual',
    'items: { kind: merge_request }',
    'once_per: "{mr.iid}:{mr.head_sha}"',
    'start: ask_first',
    'ask_first: { title: "Prepare a review of !{mr.iid}?", context: "{mr.title} by {mr.author_name}" }',
    'steps: [ { agent: claude, skill: review-mr, prompt: x } ]',
    'inbox: nish',
    ''
  ].join('\n'),
  '/a/rev.yaml'
)
const people = parsePeopleYaml('people:\n  - { id: nish, name: Nish }\n')
if (!parsed.ok || !people.ok) {
  throw new Error('setup')
}
const def = parsed.definition

function decision(sha: string, verdict: ItemDecision['verdict'] = 'asked'): ItemDecision {
  return {
    key: 'mr:1588',
    label: '!1588 web-2115',
    verdict,
    reason: '',
    checks: [],
    onceKey: `1588:${sha}`,
    fields: {
      'mr.iid': 1588,
      'mr.title': 'Filters',
      'mr.author_name': 'Emil',
      'mr.head_sha': sha,
      'worktree.path': '/wt/2115'
    }
  }
}

function setup(loaded = [def]) {
  const store = PilotStore.open(join(mkdtempSync(join(tmpdir(), 'pilot-ask-')), 'db.sqlite'))
  let clock = 1_000
  let n = 0
  const deps: AskDeps = {
    store,
    now: () => clock,
    inbox: {
      store,
      now: () => clock,
      definitions: () => loaded,
      people: () => (people.ok ? people.directory : (null as never)),
      newId: () => `in_${String(++n).padStart(16, '0')}`,
      onResolved: (item) => cancelUnstartedRun(store, item, clock)
    }
  }
  const ask = (sha: string, tickId: number) => {
    const runIds = new Map<string, string>()
    askDecisions(deps, def, [decision(sha), decision('x', 'skipped')], runIds, {
      tickId,
      runIdFor: (k) => `rev-t${tickId}-${k}-ask`
    })
    return runIds
  }
  return { store, deps, ask, advance: (ms: number) => (clock += ms) }
}

describe('askDecisions', () => {
  it('records an asking run, marks the key handled, and leaves an Approve/Skip card', () => {
    const { store, ask } = setup()
    expect(ask('cd00c0fd', 7)).toEqual(new Map([['mr:1588', 'rev-t7-1-ask']]))
    expect(store.runs.get('rev-t7-1-ask')).toMatchObject({
      status: 'asking',
      trigger: 'ask_first',
      tickId: 7,
      worktreePath: '/wt/2115'
    })
    expect(store.handledKeys('rev').has('1588:cd00c0fd')).toBe(true)
    expect(store.inbox.list({ runId: 'rev-t7-1-ask' })).toMatchObject([
      {
        type: 'action',
        title: 'Prepare a review of !1588?',
        context: 'Filters by Emil',
        person: 'nish',
        action: 'start_run',
        actionArgs: { run_id: 'rev-t7-1-ask' },
        source: 'engine',
        options: [
          { label: 'Approve', meaning: 'start it now' },
          { label: 'Skip', meaning: 'nothing starts' }
        ]
      }
    ])
  })

  it("releases the key and cancels the run when the card can't be written", () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const { store, ask } = setup([])
    expect(ask('cd00c0fd', 7)).toEqual(new Map())
    expect(store.handledKeys('rev').has('1588:cd00c0fd')).toBe(false)
    expect(store.runs.get('rev-t7-1-ask')).toMatchObject({ status: 'cancelled' })
  })

  it('makes the card of an older head stale and cancels its run when the item is asked about again', () => {
    const { store, ask } = setup()
    ask('cd00c0fd', 7)
    ask('ffff0000', 8)
    expect(store.inbox.list({ runId: 'rev-t7-1-ask' })[0]).toMatchObject({
      status: 'stale',
      outcome: 'stale: asked again for !1588 web-2115'
    })
    expect(store.runs.get('rev-t7-1-ask')).toMatchObject({
      status: 'cancelled',
      outcome: 'Not started: stale: asked again for !1588 web-2115'
    })
    expect(store.inbox.list({ runId: 'rev-t8-1-ask' })[0].status).toBe('open')
  })

  it("resolves the card as stale when Pilot's own ask row can't be recorded", () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const { store, ask } = setup()
    vi.spyOn(store.actions, 'start').mockImplementation(() => {
      throw new Error('disk full')
    })
    expect(ask('cd00c0fd', 7)).toEqual(new Map())
    expect(store.inbox.list({ runId: 'rev-t7-1-ask' })[0].status).toBe('stale')
    expect(store.runs.get('rev-t7-1-ask')?.status).toBe('cancelled')
    expect(store.handledKeys('rev').has('1588:cd00c0fd')).toBe(false)
  })

  it('cancels the asking run when the retirer closes its card as obsolete', () => {
    const { store, deps, ask } = setup()
    ask('cd00c0fd', 7)
    const card = store.inbox.list({ runId: 'rev-t7-1-ask' })[0]
    resolveInboxItem(deps.inbox, card.id, 'obsolete: !1588 merged')
    expect(store.runs.get('rev-t7-1-ask')).toMatchObject({
      status: 'cancelled',
      outcome: 'Not started: obsolete: !1588 merged'
    })
  })

  it('cancels the run when its card is skipped, and leaves a started run alone', () => {
    const { store, deps, ask } = setup()
    ask('cd00c0fd', 7)
    const card = store.inbox.list({ runId: 'rev-t7-1-ask' })[0]
    store.runs.update('rev-t7-1-ask', { status: 'running' })
    resolveInboxItem(deps.inbox, card.id, 'done: started run rev-t7-1-ask')
    expect(store.runs.get('rev-t7-1-ask')?.status).toBe('running')
    ask('ffff0000', 8)
    const second = store.inbox.list({ runId: 'rev-t8-1-ask' })[0]
    resolveInboxItem(deps.inbox, second.id, 'skipped')
    expect(store.runs.get('rev-t8-1-ask')).toMatchObject({
      status: 'cancelled',
      outcome: 'Not started: skipped'
    })
    // R-1: a person's Skip keeps the key handled, so the same head is not offered again.
    expect(store.handledKeys('rev').has('1588:ffff0000')).toBe(true)
  })
})

describe('askFirstCard', () => {
  const withOptions = parseAutomationYaml(
    [
      'name: Prepare reviews',
      'repo: web-platform',
      'schedule: manual',
      'items: { kind: merge_request }',
      'start: ask_first',
      'ask_first: { title: "Review {mr.iid}?", options: ["Review — run the review now", "Skip — not today"] }',
      'steps: [ { agent: claude, prompt: x } ]',
      ''
    ].join('\n'),
    '/a/prep.yaml'
  )

  it("uses the automation's own options, else Approve and Skip", () => {
    if (!withOptions.ok) {
      throw new Error('setup')
    }
    expect(askFirstCard(withOptions.definition, decision('cd00c0fd')).options).toEqual([
      'Review — run the review now',
      'Skip — not today'
    ])
    expect(askFirstCard(def, decision('cd00c0fd')).options).toEqual([
      'Approve — start it now',
      'Skip — nothing starts'
    ])
  })
})

describe('runAnswerOf ({run.answer}, G7)', () => {
  function asked(text: string | null) {
    const s = setup()
    s.ask('cd00c0fd', 7)
    const card = s.store.inbox.list({ runId: 'rev-t7-1-ask' })[0]
    if (text !== null) {
      s.store.inbox.update(
        card.id,
        { status: 'answered', answer: { option: null, text, digest: card.digest, via: 'page' } },
        1_001
      )
    }
    return s.store
  }

  it.each([
    ['a plain Approve', 'Approve', ''],
    ['an approval with notes', 'approve: use the second fix', 'use the second fix'],
    ['no answer yet', null, '']
  ])('an ask-first run after %s', (_name, text, expected) => {
    const store = asked(text)
    expect(runAnswerOf(store, store.runs.get('rev-t7-1-ask')!)).toBe(expected)
  })

  it("reads an answer run's answers from its answer_run event, and nothing for any other run", () => {
    const store = asked('Approve')
    store.runs.create({
      id: 'ans-1',
      automationId: 'rev',
      tickId: null,
      itemKey: 'mr:1588',
      itemLabel: '!1588',
      worktreePath: '/wt',
      startedAt: 2,
      trigger: 'answer',
      parentRunId: 'rev-t7-1-ask'
    })
    store.events.add({
      at: 2,
      runId: 'ans-1',
      kind: 'answer_run',
      payload: { answer: 'e2e', items: ['in_a'] }
    })
    store.runs.create({
      id: 'plain-1',
      automationId: 'rev',
      tickId: null,
      itemKey: 'mr:1',
      itemLabel: '!1',
      worktreePath: null,
      startedAt: 3
    })
    expect([
      runAnswerOf(store, store.runs.get('ans-1')!),
      runAnswerOf(store, store.runs.get('plain-1')!)
    ]).toEqual(['e2e', null])
  })
})

describe('runChoiceOf ({run.choice})', () => {
  const multi = parseAutomationYaml(
    [
      'name: Prepare reviews requested of me',
      'repo: web-platform',
      'schedule: manual',
      'items: { kind: merge_request }',
      'once_per: "{mr.iid}:{mr.head_sha}"',
      'start: ask_first',
      'ask_first:',
      '  title: "Prepare a review of !{mr.iid}?"',
      '  context: x',
      '  options: ["Backend — a backend stack", "Full stack + UI — the frontends too", "Skip — not now"]',
      'steps: [ { agent: claude, skill: review-mr, prompt: x } ]',
      'inbox: nish',
      ''
    ].join('\n'),
    '/a/rev.yaml'
  )
  if (!multi.ok) {
    throw new Error('setup')
  }

  function answered(definition: AutomationDefinition, option: number | null, text: string) {
    const s = setup([definition])
    askDecisions(s.deps, definition, [decision('cd00c0fd')], new Map(), {
      tickId: 7,
      runIdFor: () => 'rev-ask'
    })
    const card = s.store.inbox.list({ runId: 'rev-ask' })[0]
    s.store.inbox.update(
      card.id,
      { status: 'answered', answer: { option, text, digest: card.digest, via: 'page' } },
      1_001
    )
    return runChoiceOf(s.store, s.store.runs.get('rev-ask')!)
  }

  it.each<[string, number | null, string, string]>([
    ['the first option', 0, 'Backend', 'Backend'],
    ['the second start option', 1, 'Full stack + UI', 'Full stack + UI'],
    ['the second start option, with notes', 1, 'approve: check the migration', 'Full stack + UI'],
    ['words, no option', null, 'approve', 'Backend']
  ])('a card with two start options, answered with %s', (_, option, text, choice) => {
    expect(answered(multi.definition, option, text)).toBe(choice)
  })

  it("is the first option's label on a single-start card, and '' for any run that didn't ask first", () => {
    expect(answered(def, null, 'approve: use the second fix')).toBe('Approve')
    const s = setup()
    s.store.runs.create({
      id: 'plain-1',
      automationId: 'rev',
      tickId: null,
      itemKey: 'mr:1',
      itemLabel: '!1',
      worktreePath: null,
      startedAt: 3
    })
    expect(runChoiceOf(s.store, s.store.runs.get('plain-1')!)).toBe('')
  })
})

describe('approving an ask-first card (Group 22)', () => {
  function approvable() {
    const s = setup()
    const tickId = s.store.startTick('rev', 1)
    s.ask('cd00c0fd', tickId)
    const start = vi.fn().mockResolvedValue(undefined)
    s.store.recordDecisions(tickId, [decision('cd00c0fd')], new Map())
    const runId = `rev-t${tickId}-1-ask`
    const entry = startRunEntry({
      store: s.store,
      now: () => 1_000,
      definitions: () => [def],
      start,
      schedulerOn: () => true,
      displayOnly: () => []
    })
    const catalog: ActionCatalog = {
      entries: () => [entry],
      get: (n) => (n === 'start_run' ? entry : null)
    }
    const attempt = {
      store: s.store,
      now: () => 1_000,
      catalog,
      definitions: () => [def],
      inbox: s.deps.inbox
    }
    return { ...s, start, attempt, runId }
  }

  it("records Pilot's own ask under the card, with the card's args digest", () => {
    const { store, runId } = approvable()
    const card = store.inbox.list({ runId })[0]
    const rows = store.actions.forInboxItem(card.id)
    expect(rows).toMatchObject([
      { action: 'start_run', status: 'refused', digest: argsDigest('start_run', { run_id: runId }) }
    ])
    expect(JSON.parse(rows[0].output ?? '{}')).toMatchObject({ outcome: 'asked' })
  })

  it('starts exactly one run when the card is approved, and refuses a second approval', async () => {
    const { store, start, attempt, runId } = approvable()
    const card = store.inbox.list({ runId })[0]
    const req = {
      action: 'start_run',
      dryRun: false,
      runId: card.runId,
      approved: true as const,
      inboxItemId: card.id,
      digest: card.digest
    }
    expect(await attemptAction(attempt, req)).toMatchObject({
      outcome: 'done',
      detail: `started run ${runId}`
    })
    expect(await attemptAction(attempt, req)).toMatchObject({ outcome: 'failed' })
    expect(start).toHaveBeenCalledTimes(1)
  })

  it('never lets a run ask for an approval-only action: no card, no asked row', async () => {
    const { store, attempt, runId } = approvable()
    store.runs.create({
      id: 'agent-1',
      automationId: 'rev',
      tickId: null,
      itemKey: 'mr:1588',
      itemLabel: '!1588',
      worktreePath: '/wt',
      startedAt: 2
    })
    const before = store.inbox.list({}).length
    const result = await attemptAction(attempt, {
      action: 'start_run',
      dryRun: false,
      runId: 'agent-1',
      approved: false,
      inboxItemId: null,
      args: { run_id: runId }
    })
    expect(result).toMatchObject({
      outcome: 'failed',
      detail: expect.stringContaining('only Pilot asks')
    })
    expect(store.inbox.list({}).length).toBe(before)
    expect(store.inbox.list({ runId: 'agent-1' })).toEqual([])
  })

  it("doesn't cancel another run's asking run when an agent's start_run card closes", () => {
    const { store, deps, runId } = approvable()
    store.runs.create({
      id: 'agent-1',
      automationId: 'rev',
      tickId: null,
      itemKey: 'mr:1588',
      itemLabel: '!1588',
      worktreePath: '/wt',
      startedAt: 2
    })
    const filed = addInboxItem(deps.inbox, {
      runId: 'agent-1',
      type: 'action',
      title: 'Go?',
      options: ['Approve'],
      action: 'start_run',
      actionArgs: { run_id: runId }
    })
    vi.spyOn(console, 'error').mockImplementation(() => {})
    resolveInboxItem(deps.inbox, filed.id ?? '', 'skipped')
    expect(store.runs.get(runId)?.status).toBe('asking')
  })

  it('refuses an agent-filed start_run card, which Pilot never asked about', async () => {
    const { store, deps, start, attempt, runId } = approvable()
    store.runs.create({
      id: 'agent-1',
      automationId: 'rev',
      tickId: null,
      itemKey: 'mr:1588',
      itemLabel: '!1588',
      worktreePath: '/wt',
      startedAt: 2
    })
    const filed = addInboxItem(deps.inbox, {
      runId: 'agent-1',
      type: 'action',
      title: 'Go?',
      options: ['Approve'],
      action: 'start_run',
      actionArgs: { run_id: runId }
    })
    const card = store.inbox.get(filed.id ?? '')!
    const result = await attemptAction(attempt, {
      action: 'start_run',
      dryRun: false,
      runId: 'agent-1',
      approved: true,
      inboxItemId: card.id,
      digest: card.digest
    })
    expect(result).toMatchObject({
      outcome: 'failed',
      detail: expect.stringContaining("Pilot didn't ask")
    })
    expect(start).not.toHaveBeenCalled()
  })
})
