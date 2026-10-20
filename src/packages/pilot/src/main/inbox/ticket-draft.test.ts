import { describe, expect, it } from 'vitest'
import type { ItemFields } from '../../shared/api-types'
import type { DetailsSnapshot } from '../../shared/details'
import { formatTicketedOutcome, ticketRefusal } from '../../shared/ticket-outcome'
import type { TicketedRef } from '../../shared/ticket-types'
import { callerStore, DEFINITIONS } from '../actions/__fixtures__/caller-store'
import type { NewInboxItem } from '../store/store-inbox'
import { skillsWithTemplate } from './__fixtures__/follow-up-ticket'
import { buildTicketDraft, withVaultPaths, type TicketDraftDeps } from './ticket-draft'

const ROOT = '/vault/Automations'
const MR = 'https://gitlab.com/g/p/-/merge_requests/9'
const DIGEST = 'd'.repeat(64)
const CREATED = Date.UTC(2026, 9, 18, 11, 20)
const REF: TicketedRef = { identifier: 'WEB-7', url: 'https://linear.app/x/issue/WEB-7' }

const SNAPSHOT: DetailsSnapshot = {
  ref: {
    path: `${ROOT}/04 · x/r/details.json`,
    sha256: 'a'.repeat(64),
    inlined: {},
    blocks: 2,
    drafted: false,
    draftedBase: null
  },
  bundle: {
    version: 1,
    item: 'wt:7',
    blocks: [
      {
        type: 'shots',
        shots: [
          { file: 'shot-a.png', caption: 'Sidebar' },
          { file: 'shot-b.png', caption: 'Menu' },
          { file: 'shot-a.png', caption: 'Sidebar again' }
        ]
      },
      {
        type: 'screens',
        pairs: [{ before: 'header-before.png', after: 'header-after.png', caption: 'Header' }]
      }
    ]
  },
  texts: {}
}

const card = (id: string, extra: Partial<NewInboxItem> = {}): NewInboxItem => ({
  id,
  automationId: 'ui-qa-overnight',
  runId: 'run_1',
  stepIdx: 1,
  itemKey: 'wt:7',
  worktreePath: '/wt/7',
  person: 'nish',
  type: 'left_for_you',
  title: 'F2 Mixed colors — a.tsx:1',
  context: 'Seen in file:///vault/Automations/04%20%C2%B7%20x/r/index.html#F2 on load.',
  options: [],
  suggested: 'Clamp the width.',
  detailsMd: null,
  action: null,
  actionArgs: null,
  digest: DIGEST,
  createdAt: CREATED,
  source: 'engine',
  vaultRef: null,
  ...extra
})

function seeded(over: { card?: Partial<NewInboxItem>; fields?: ItemFields } = {}) {
  const fixture = callerStore()
  fixture.run('run_1', 'ui-qa-overnight', 'wt:7', '/wt/7', {
    'worktree.branch': 'feat/x',
    'mr.web_url': MR,
    'mr.title': 'Fix the sidebar',
    ...over.fields
  })
  fixture.store.inbox.add(card('in_1', over.card), SNAPSHOT)
  const skills = skillsWithTemplate()
  const deps: TicketDraftDeps = {
    store: fixture.store,
    definitions: () => DEFINITIONS,
    detailsRoot: ROOT,
    skillDirs: () => [skills.dir]
  }
  return { ...fixture, deps, templatePath: skills.file }
}

const found = new Intl.DateTimeFormat('en-US', {
  month: 'short',
  day: 'numeric',
  hour: 'numeric',
  minute: '2-digit'
}).format(CREATED)

describe('buildTicketDraft', () => {
  it('fills the template from the card, its run fields and its Details images', () => {
    const { deps, templatePath } = seeded()
    expect(buildTicketDraft(deps, 'in_1', DIGEST)).toEqual({
      title: 'F2 Mixed colors',
      body: [
        `**From** 04 · Test branch UIs overnight · ${found}`,
        'Where: `a.tsx:1` on `feat/x`',
        '',
        '## What was found',
        'Seen in `Automations/04 · x/r/index.html#F2` on load.',
        '',
        '## Suggested',
        'Clamp the width.',
        '',
        '## Evidence',
        '![Sidebar](pilot-image:1)',
        '![Menu](pilot-image:2)',
        '![Header (before)](pilot-image:3)',
        '![Header (after)](pilot-image:4)',
        `- MR: ${MR}`,
        '',
        '---',
        'Filed for later from Pilot · pilot-item `ui-qa-overnight:wt:7`'
      ].join('\n'),
      team: 'WEB',
      state: 'Triage',
      priority: 'low',
      labels: [],
      assignee: null,
      images: [
        { ref: 'pilot-image:1', file: 'shot-a.png', caption: 'Sidebar' },
        { ref: 'pilot-image:2', file: 'shot-b.png', caption: 'Menu' },
        { ref: 'pilot-image:3', file: 'header-before.png', caption: 'Header (before)' },
        { ref: 'pilot-image:4', file: 'header-after.png', caption: 'Header (after)' }
      ],
      link: { url: MR, title: 'Fix the sidebar' },
      ticketedBefore: null,
      templatePath,
      digest: DIGEST
    })
  })

  it.each<{ name: string; fields: ItemFields; link: { url: string; title: string } | null }>([
    { name: 'no MR url', fields: { 'mr.web_url': null }, link: null },
    { name: 'a non-http MR url', fields: { 'mr.web_url': 'file:///x/mr' }, link: null },
    {
      name: 'an http MR url with no title',
      fields: { 'mr.web_url': 'http://gitlab.local/mr/1', 'mr.title': null },
      link: { url: 'http://gitlab.local/mr/1', title: 'Merge request' }
    }
  ])('links $name as $link', ({ fields, link }) => {
    const { deps } = seeded({ fields })
    expect(buildTicketDraft(deps, 'in_1', DIGEST).link).toEqual(link)
  })

  it("reads a card outside a run from its item's latest tick", () => {
    const { deps, tick } = seeded({ card: { runId: null } })
    tick('ui-qa-overnight', 5, [['wt:7', { 'worktree.branch': 'feat/y' }]])
    const draft = buildTicketDraft(deps, 'in_1', DIGEST)
    expect(draft.body).toContain('Where: `a.tsx:1` on `feat/y`')
    expect(draft.link).toBeNull()
  })

  it('carries the ticket a done card of the same finding was filed as', () => {
    const { store, deps } = seeded()
    store.inbox.add(card('old', { title: 'F2 Mixed colors — b.tsx:9' }))
    store.inbox.update('old', { status: 'done', outcome: formatTicketedOutcome(REF) }, 10)
    expect(buildTicketDraft(deps, 'in_1', DIGEST).ticketedBefore).toEqual(REF)
  })

  it.each<{ name: string; card: Partial<NewInboxItem>; id: string; digest: string; error: string }>(
    [
      {
        name: 'a digest that is not the card’s',
        card: {},
        id: 'in_1',
        digest: 'e'.repeat(64),
        error: 'The card changed; reopen the draft'
      },
      {
        name: 'an action card',
        card: { type: 'action', action: 'linear_create' },
        id: 'in_1',
        digest: DIGEST,
        error: ticketRefusal({ status: 'open', type: 'action', itemKey: 'wt:7' }) ?? ''
      },
      { name: 'no such card', card: {}, id: 'in_9', digest: DIGEST, error: 'No inbox item in_9' }
    ]
  )('refuses $name', ({ card: over, id, digest, error }) => {
    const { deps } = seeded({ card: over })
    expect(() => buildTicketDraft(deps, id, digest)).toThrow(error)
  })
})

describe('withVaultPaths', () => {
  it.each<{ name: string; text: string; root: string | null; expected: string }>([
    {
      name: 'a bare link, keeping the sentence’s full stop',
      text: 'See file:///vault/Automations/a%20b/r.html.',
      root: ROOT,
      expected: 'See `Automations/a b/r.html`.'
    },
    {
      name: 'a markdown link, keeping its label',
      text: 'Read [the report](file:///vault/Automations/r.html#F1) first',
      root: ROOT,
      expected: 'Read the report (`Automations/r.html#F1`) first'
    },
    {
      name: 'an autolink',
      text: '<file:///vault/Automations/r.html>',
      root: ROOT,
      expected: '`Automations/r.html`'
    },
    {
      name: 'a file outside the Automations folder',
      text: 'file:///tmp/x.png',
      root: ROOT,
      expected: '`/tmp/x.png`'
    },
    {
      name: 'any file with no Automations folder',
      text: 'file:///vault/Automations/r.html',
      root: null,
      expected: '`/vault/Automations/r.html`'
    },
    {
      name: 'an https link, untouched',
      text: '[MR](https://gitlab.com/g/p/-/merge_requests/9)',
      root: ROOT,
      expected: '[MR](https://gitlab.com/g/p/-/merge_requests/9)'
    }
  ])('rewrites $name', ({ text, root, expected }) => {
    expect(withVaultPaths(text, root)).toBe(expected)
  })
})
