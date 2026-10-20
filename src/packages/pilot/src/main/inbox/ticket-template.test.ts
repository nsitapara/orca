import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import type { ItemFields } from '../../shared/api-types'
import { skillsWithTemplate, TICKET_BODY, TICKET_MD } from './__fixtures__/follow-up-ticket'
import { loadTicketTemplate, renderTicketBody, TICKET_TEMPLATE_PATH } from './ticket-template'

const FIELDS: ItemFields = {
  title: 'F2 Mixed colors',
  job: '04 · Test branch UIs overnight',
  found: 'Oct 18, 4:20 AM',
  location: 'a.tsx:1',
  branch: 'feat/x',
  context: 'The menu clips.',
  suggested: 'Clamp the width.',
  screenshots: '![Sidebar](pilot-image:1)',
  'mr.web_url': 'https://gitlab.com/g/p/-/merge_requests/9',
  automation_id: 'ui-qa-overnight',
  item_key: 'wt:7',
  card_id: 'in_1'
}

const lines = (...rows: string[]) => rows.join('\n')
const FOOTER = ['---', 'Filed for later from Pilot · pilot-item `ui-qa-overnight:wt:7`']

describe('renderTicketBody', () => {
  const cases: { name: string; fields: ItemFields; expected: string }[] = [
    {
      name: 'all fields present renders every line',
      fields: {},
      expected: lines(
        '**From** 04 · Test branch UIs overnight · Oct 18, 4:20 AM',
        'Where: `a.tsx:1` on `feat/x`',
        '',
        '## What was found',
        'The menu clips.',
        '',
        '## Suggested',
        'Clamp the width.',
        '',
        '## Evidence',
        '![Sidebar](pilot-image:1)',
        '- MR: https://gitlab.com/g/p/-/merge_requests/9',
        '',
        ...FOOTER
      )
    },
    {
      name: 'no location drops the Where line only',
      fields: { location: null },
      expected: lines(
        '**From** 04 · Test branch UIs overnight · Oct 18, 4:20 AM',
        '',
        '## What was found',
        'The menu clips.',
        '',
        '## Suggested',
        'Clamp the width.',
        '',
        '## Evidence',
        '![Sidebar](pilot-image:1)',
        '- MR: https://gitlab.com/g/p/-/merge_requests/9',
        '',
        ...FOOTER
      )
    },
    {
      name: 'empty suggested drops its heading and its line',
      fields: { suggested: '' },
      expected: lines(
        '**From** 04 · Test branch UIs overnight · Oct 18, 4:20 AM',
        'Where: `a.tsx:1` on `feat/x`',
        '',
        '## What was found',
        'The menu clips.',
        '',
        '## Evidence',
        '![Sidebar](pilot-image:1)',
        '- MR: https://gitlab.com/g/p/-/merge_requests/9',
        '',
        ...FOOTER
      )
    },
    {
      name: 'no screenshots and no MR drop Evidence entirely',
      fields: { screenshots: '', 'mr.web_url': null },
      expected: lines(
        '**From** 04 · Test branch UIs overnight · Oct 18, 4:20 AM',
        'Where: `a.tsx:1` on `feat/x`',
        '',
        '## What was found',
        'The menu clips.',
        '',
        '## Suggested',
        'Clamp the width.',
        '',
        ...FOOTER
      )
    },
    {
      name: 'a context with braces, backticks and bold comes out byte-identical',
      fields: { context: 'Clicking `{title}` shows **{job}** and {mr.web_url} twice' },
      expected: lines(
        '**From** 04 · Test branch UIs overnight · Oct 18, 4:20 AM',
        'Where: `a.tsx:1` on `feat/x`',
        '',
        '## What was found',
        'Clicking `{title}` shows **{job}** and {mr.web_url} twice',
        '',
        '## Suggested',
        'Clamp the width.',
        '',
        '## Evidence',
        '![Sidebar](pilot-image:1)',
        '- MR: https://gitlab.com/g/p/-/merge_requests/9',
        '',
        ...FOOTER
      )
    },
    {
      name: 'a two-line screenshots value is inserted intact',
      fields: { screenshots: '![Sidebar](pilot-image:1)\n![Menu](pilot-image:2)' },
      expected: lines(
        '**From** 04 · Test branch UIs overnight · Oct 18, 4:20 AM',
        'Where: `a.tsx:1` on `feat/x`',
        '',
        '## What was found',
        'The menu clips.',
        '',
        '## Suggested',
        'Clamp the width.',
        '',
        '## Evidence',
        '![Sidebar](pilot-image:1)',
        '![Menu](pilot-image:2)',
        '- MR: https://gitlab.com/g/p/-/merge_requests/9',
        '',
        ...FOOTER
      )
    },
    {
      name: 'a value ending in blank lines leaves no run of blank lines',
      fields: { context: 'The menu clips.\n\n\n', suggested: null, screenshots: '' },
      expected: lines(
        '**From** 04 · Test branch UIs overnight · Oct 18, 4:20 AM',
        'Where: `a.tsx:1` on `feat/x`',
        '',
        '## What was found',
        'The menu clips.',
        '',
        '## Evidence',
        '- MR: https://gitlab.com/g/p/-/merge_requests/9',
        '',
        ...FOOTER
      )
    }
  ]

  it.each(cases)('$name', ({ fields, expected }) => {
    const body = renderTicketBody(TICKET_BODY, { ...FIELDS, ...fields })
    expect(body).toBe(expected)
    expect(body).not.toMatch(/\n[ \t]*\n[ \t]*\n/)
    expect(body).toBe(body.trimEnd())
  })
})

describe('loadTicketTemplate', () => {
  it('reads the first folder that has the template, with its defaults and body', () => {
    const first = skillsWithTemplate()
    const second = skillsWithTemplate(TICKET_MD.replace('team: WEB', 'team: OPS'))
    const missing = mkdtempSync(join(tmpdir(), 'pilot-ticket-none-'))
    expect(loadTicketTemplate([missing, first.dir, second.dir])).toEqual({
      path: first.file,
      defaults: {
        team: 'WEB',
        state: 'Triage',
        priority: 'low',
        labels: [],
        assignee: null,
        title: '{title}'
      },
      body: TICKET_BODY
    })
  })

  it.each([
    ['no assignee line', '', null],
    ['an empty one', 'assignee:\n', null],
    ['assignee: me', 'assignee: me\n', 'me']
  ])('reads the assignee from %s', (_name, line, assignee) => {
    const { dir } = skillsWithTemplate(TICKET_MD.replace('labels: []\n', `labels: []\n${line}`))
    expect(loadTicketTemplate([dir]).defaults.assignee).toBe(assignee)
  })

  it('names every path it tried when there is no template', () => {
    const a = mkdtempSync(join(tmpdir(), 'pilot-ticket-none-'))
    const b = mkdtempSync(join(tmpdir(), 'pilot-ticket-none-'))
    expect(() => loadTicketTemplate([a, b])).toThrow(
      `Ticket template not found: ${join(a, TICKET_TEMPLATE_PATH)}, ${join(b, TICKET_TEMPLATE_PATH)}`
    )
  })

  it.each([
    ['priority: low', 'priority: soon', 'priority must be one of none, urgent, high, medium, low'],
    ['team: WEB', "team: ''", 'team must be a non-empty string'],
    ['state: Triage', 'state: 3', 'state must be a non-empty string'],
    ["title: '{title}'", 'title:', 'title must be a non-empty string'],
    ['labels: []', 'labels: [bug, 2]', 'labels must be a list of strings'],
    ['labels: []', "labels: []\nassignee: ' '", 'assignee must be a non-empty string when set']
  ])('refuses %s replaced by %s, naming the path and the field', (from, to, problem) => {
    const { dir, file } = skillsWithTemplate(TICKET_MD.replace(from, to))
    expect(() => loadTicketTemplate([dir])).toThrow(`${file}: ${problem}`)
  })

  it('refuses invalid YAML, naming the path', () => {
    const { dir, file } = skillsWithTemplate(TICKET_MD.replace('labels: []', 'labels: [bug'))
    expect(() => loadTicketTemplate([dir])).toThrow(`${file}: frontmatter isn't valid YAML`)
  })
})
