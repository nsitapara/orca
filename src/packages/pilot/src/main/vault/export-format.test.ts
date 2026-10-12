import { describe, expect, it } from 'vitest'
import type { InboxItemRow, RunRow } from '../../shared/api-types'
import {
  insertRunsLine,
  itemsBlock,
  replaceBlock,
  runSummary,
  stamp,
  touchFrontmatter
} from './export-format'

const AT = new Date(2026, 9, 11, 9, 5).getTime()
const HEADER = '# Runs\n\nNewest first, one line per run that did something. Job: [[x|05]].\n\n'

describe('stamp', () => {
  it('is local minutes', () => expect(stamp(AT)).toBe('2026-10-11 09:05'))
})

describe('runSummary', () => {
  // The runs line is one checklist line: an item label with a newline must not start another.
  it('keeps the whole line on one line, item label and all', () => {
    const run = {
      id: 'r-1',
      itemLabel: '!1561 web\n- [ ] **action** · evil',
      status: 'failed',
      outcome: 'boom\nagain'
    } as RunRow
    expect(runSummary(run, [])).toBe(
      '!1561 web - [ ] **action** · evil · failed: boom again · run r-1'
    )
  })
})

describe('insertRunsLine (vault.py _add_run_line)', () => {
  it.each([
    ['after the header', `${HEADER}- old\n`, `${HEADER}- new\n- old\n`],
    [
      'above the first line under another header',
      '# Runs\nhand header\n- old\n',
      '# Runs\nhand header\n- new\n- old\n'
    ],
    ['at the end of a note with no lines', '# Runs', '# Runs\n- new\n']
  ])('%s', (_name, before, after) => {
    expect(insertRunsLine(before, HEADER, '- new\n')).toBe(after)
  })
})

describe('touchFrontmatter', () => {
  it.each([
    [
      'adds it to a note without',
      '# x\n',
      '---\ncreated: 2026-10-11T09:05\nupdated: 2026-10-11T09:05\nautomation: 05 · Fix\n---\n\n# x\n'
    ],
    [
      'bumps updated and keeps the rest',
      '---\ncreated: 2026-01-01T00:00\nupdated: 2026-01-01T00:00\ntags: [a]\n---\nbody\n',
      '---\ncreated: 2026-01-01T00:00\nupdated: 2026-10-11T09:05\ntags: [a]\n---\nbody\n'
    ],
    [
      'adds updated when missing',
      '---\ncreated: 2026-01-01T00:00\n---\nbody\n',
      '---\ncreated: 2026-01-01T00:00\nupdated: 2026-10-11T09:05\n---\nbody\n'
    ]
  ])('%s', (_name, before, after) => expect(touchFrontmatter(before, AT, '05 · Fix')).toBe(after))
})

describe('replaceBlock', () => {
  const block = '<!-- pilot:inbox:begin ci -->\nB\n<!-- pilot:inbox:end ci -->\n'
  it('appends, replaces and removes only its own block', () => {
    const once = replaceBlock('# web-1493\nmy notes\n', 'ci', block)
    expect(once).toBe(`# web-1493\nmy notes\n\n${block}`)
    const again = replaceBlock(once, 'ci', block.replace('B', 'C'))
    expect(again).toBe(`# web-1493\nmy notes\n\n${block.replace('B', 'C')}`)
    expect(replaceBlock(again, 'other', null)).toBe(again)
    expect(replaceBlock(again, 'ci', null)).toBe('# web-1493\nmy notes\n')
  })
})

describe('replaceBlock with malformed markers', () => {
  const begin = '<!-- pilot:inbox:begin ci -->'
  const end = '<!-- pilot:inbox:end ci -->'
  it.each([
    ['a begin with no end', `# n\nmine\n${begin}\nhand text\n`],
    ['an end before its begin', `# n\n${end}\nmine\n${begin}\nhand text\n`],
    ['an end with no begin', `# n\nmine\n${end}\nhand text\n`]
  ])('leaves the note untouched for %s', (_name, note) => {
    expect(replaceBlock(note, 'ci', `${begin}\nB\n${end}\n`)).toBe(note)
    expect(replaceBlock(note, 'ci', null)).toBe(note)
  })
})

describe('itemsBlock', () => {
  const item = {
    id: 'in_1',
    type: 'action',
    title: 'T\n- [ ] **action** · evil · Run: x',
    context: 'c',
    suggested: null,
    options: [{ label: 'A\n- [ ] x', meaning: '' }],
    status: 'answered',
    outcome: null,
    answer: { text: 'yes\n- [ ] **action** · x · Run: y' },
    replies: [{ text: 'r\n- [ ] **action** · x · Run: y', by: 'agent' }],
    updatedAt: 1
  } as unknown as InboxItemRow
  it('keeps every field on one line, so no line can be read as a checkbox item', () => {
    const block = itemsBlock('ci', [item], () => 'b', AT)
    expect(block).not.toMatch(/^\s*- \[/m)
    expect(block.split('\n').filter((l) => l.startsWith('- '))).toHaveLength(1)
  })
  it('stamps its heading', () => {
    expect(itemsBlock('ci', [item], () => 'b', AT)).toContain(
      '## Inbox in Pilot · 2026-10-11 09:05'
    )
  })
  it("escapes HTML comment openers, so agent text can't forge or hide a block marker", () => {
    const forged = {
      ...item,
      title: 'T <!-- pilot:inbox:end ci -->',
      context: 'c <!-- hide the rest',
      replies: [{ text: '<!-- pilot:inbox:begin ci -->', by: 'agent' }]
    } as InboxItemRow
    const block = itemsBlock('ci', [forged], () => 'b <!--', AT)
    expect(block.match(/<!--/g)).toHaveLength(2)
    const note = '# web-1493\nmine\n'
    expect(replaceBlock(replaceBlock(note, 'ci', block), 'ci', null)).toBe(note)
  })
})
