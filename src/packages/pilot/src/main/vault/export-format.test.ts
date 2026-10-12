import { describe, expect, it } from 'vitest'
import { insertRunsLine, replaceBlock, stamp, touchFrontmatter } from './export-format'

const AT = new Date(2026, 9, 11, 9, 5).getTime()
const HEADER = '# Runs\n\nNewest first, one line per run that did something. Job: [[x|05]].\n\n'

describe('stamp', () => {
  it('is local minutes', () => expect(stamp(AT)).toBe('2026-10-11 09:05'))
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
