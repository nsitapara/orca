import { describe, expect, it } from 'vitest'
import type { DetailsBlock, DetailsBundle } from '../../shared/details'
import { sectionsOf } from './sections'

const bundle = (...blocks: DetailsBlock[]): DetailsBundle => ({ version: 1, item: 'x', blocks })
const diff = (title?: string): DetailsBlock => ({
  type: 'diff',
  title,
  files: [
    { path: 'a.ts', hunks: [] },
    { path: 'b.ts', hunks: [] }
  ]
})

describe('sectionsOf', () => {
  it('has one section per block, in bundle order, labelled by title or by type', () => {
    const sections = sectionsOf(
      bundle(
        { type: 'facts', title: 'What Approve does', rows: [] },
        diff(),
        { type: 'screens', pairs: [] },
        { type: 'shots', shots: [{ file: 'a' }, { file: 'b' }, { file: 'c' }] },
        { type: 'code', path: 'a', rows: [] },
        { type: 'thread', notes: [] },
        { type: 'text', body: 'x' },
        { type: 'missing', what: 'a', why: 'b' },
        { type: 'review', file: 'r.json' }
      ),
      { 'r.json': JSON.stringify({ parts: [{ id: '1' }, { id: '2' }] }) }
    )
    expect(sections.map((s) => [s.label, s.count])).toEqual([
      ['What Approve does', ''],
      ['Change', '2'],
      ['Before / after', ''],
      ['Screenshots', '3'],
      ['Code', ''],
      ['Thread', ''],
      ['Notes', ''],
      ['Missing', ''],
      ['Review', '2']
    ])
  })

  it('keys a section by type and title, so the choice carries across cards', () => {
    const [a, b] = sectionsOf(bundle(diff('Proposed change'), diff()), {})
    expect(a.key).toBe('diff:Proposed change')
    expect(b.key).toBe('diff:')
  })

  it('gives two blocks with the same type and title one pill', () => {
    expect(sectionsOf(bundle(diff(), diff()), {})).toHaveLength(1)
  })
})
