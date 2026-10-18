// @vitest-environment happy-dom
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type {
  DetailsBlock,
  DetailsBundle,
  DetailsSnapshot,
  DiffFile,
  DiffRow
} from '../../shared/details'
import { DetailsView } from './DetailsView'
import { resetSectionFilter, setAllSections } from './section-filter'

const REF = {
  path: '/b.json',
  sha256: 'x',
  inlined: {},
  blocks: 1,
  drafted: false,
  draftedBase: null
}
const rows = (n: number): DiffRow[] =>
  Array.from({ length: n }, (_, i) => [i + 1, i + 1, '+', `line ${i}`] as DiffRow)
function snap(...blocks: DetailsBlock[]): DetailsSnapshot {
  const bundle: DetailsBundle = { version: 1, item: 'x', blocks }
  return { ref: REF, bundle, texts: {} }
}
const FACTS: DetailsBlock = { type: 'facts', title: 'Overview', rows: [['Then', 'one commit']] }
const TEXT: DetailsBlock = { type: 'text', title: 'What QA saw', body: 'a toast' }
const view = (s: DetailsSnapshot) =>
  render(<DetailsView snapshot={s} loadImage={async () => 'blob:x'} />)

beforeEach(() => {
  window.localStorage.clear()
  resetSectionFilter()
})
afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

describe('the section toggles', () => {
  it('is a toolbar of pressed-by-default pills, one per section, that hide and show their section', () => {
    view(snap(FACTS, TEXT))
    const bar = screen.getByRole('toolbar', { name: 'Show sections' })
    const pills = within(bar).getAllByRole('button')
    expect(pills.map((p) => p.textContent)).toEqual(['Overview', 'What QA saw'])
    expect(pills.every((p) => p.getAttribute('aria-pressed') === 'true')).toBe(true)
    expect(screen.getByText('a toast')).toBeTruthy()
    fireEvent.click(pills[1])
    expect(pills[1].getAttribute('aria-pressed')).toBe('false')
    expect(screen.queryByText('a toast')).toBeNull()
    expect(screen.getByText('one commit')).toBeTruthy()
    fireEvent.click(pills[1])
    expect(screen.getByText('a toast')).toBeTruthy()
  })

  it('says so when no section is switched on', () => {
    view(snap(FACTS, TEXT))
    for (const pill of within(screen.getByRole('toolbar')).getAllByRole('button')) {
      fireEvent.click(pill)
    }
    expect(screen.getByText('No sections switched on. Pick one above.')).toBeTruthy()
  })

  it('All and None set every section of the card', () => {
    view(snap(FACTS, TEXT))
    const keys = ['facts:Overview', 'text:What QA saw']
    act(() => setAllSections(keys, false))
    expect(screen.getByText('No sections switched on. Pick one above.')).toBeTruthy()
    act(() => setAllSections(keys, true))
    expect(screen.queryByText('No sections switched on. Pick one above.')).toBeNull()
    expect(screen.getByText('a toast')).toBeTruthy()
  })

  it('remembers what was switched off, for the next card, in localStorage', () => {
    const first = view(snap(FACTS, TEXT))
    fireEvent.click(screen.getByRole('button', { name: 'What QA saw' }))
    expect(JSON.parse(window.localStorage.getItem('pilot.details.off') ?? '[]')).toEqual([
      'text:What QA saw'
    ])
    first.unmount()
    resetSectionFilter()
    view(snap(FACTS, TEXT))
    expect(screen.getByRole('button', { name: 'What QA saw' }).getAttribute('aria-pressed')).toBe(
      'false'
    )
    expect(screen.queryByText('a toast')).toBeNull()
  })

  it('still works, for this session, when storage throws', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blocked')
    })
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('blocked')
    })
    resetSectionFilter()
    view(snap(FACTS, TEXT))
    fireEvent.click(screen.getByRole('button', { name: 'What QA saw' }))
    expect(screen.queryByText('a toast')).toBeNull()
  })

  it('shows a diff’s file count, a review’s findings and a shot count on their pills', () => {
    const diff: DetailsBlock = {
      type: 'diff',
      title: 'Proposed change',
      files: [{ path: 'a.ts', hunks: [] }]
    }
    view(snap(diff, { type: 'shots', title: 'QA', shots: [{ file: 'a' }, { file: 'b' }] }))
    expect(screen.getByRole('button', { name: /Proposed change/ }).textContent).toBe(
      'Proposed change1'
    )
    expect(screen.getByRole('button', { name: /QA/ }).textContent).toBe('QA2')
  })
})

describe('the files of a diff', () => {
  const file = (path: string, n: number, extra: Partial<DiffFile> = {}) => ({
    path,
    added: n,
    removed: 0,
    hunks: [rows(n)],
    ...extra
  })
  const diff = (...files: ReturnType<typeof file>[]): DetailsBlock => ({
    type: 'diff',
    title: 'Change',
    files: files as never
  })
  const bodyOpen = (path: string) =>
    screen.getByTitle(path).closest('.glr-file')!.querySelector('table') !== null

  it('starts generated files and files over 300 rows folded, the rest open', () => {
    view(
      snap(
        diff(
          file('api/gql/queries.json', 2),
          file('src/big.ts', 301),
          file('src/ok.ts', 300),
          file('src/generated/users.ts', 2),
          file('pnpm-lock.yaml', 2),
          file('src/a.generated.ts', 2),
          file('yarn.lock', 2)
        )
      )
    )
    expect(
      [
        'api/gql/queries.json',
        'src/big.ts',
        'src/ok.ts',
        'src/generated/users.ts',
        'pnpm-lock.yaml',
        'src/a.generated.ts',
        'yarn.lock'
      ].map(bodyOpen)
    ).toEqual([false, false, true, false, false, false, false])
  })

  it('tags generated and new files, and shows +A −R', () => {
    view(
      snap(
        diff(
          file('api/gql/queries.json', 1),
          file('src/new.ts', 3, { old_path: null, removed: 0 }),
          file('src/old.ts', 3, { old_path: 'src/old.ts', removed: 1 })
        )
      )
    )
    const header = (path: string) => screen.getByTitle(path).closest('button')!
    expect(header('api/gql/queries.json').textContent).toContain('generated')
    expect(header('src/new.ts').textContent).toContain('new file')
    expect(header('src/new.ts').textContent).toContain('+3')
    expect(header('src/old.ts').textContent).not.toMatch(/new file|generated/)
  })

  it('folds a file on its own', () => {
    view(snap(diff(file('src/ok.ts', 2))))
    const header = screen.getByTitle('src/ok.ts').closest('button')!
    expect(header.getAttribute('aria-expanded')).toBe('true')
    fireEvent.click(header)
    expect(header.getAttribute('aria-expanded')).toBe('false')
    expect(bodyOpen('src/ok.ts')).toBe(false)
  })

  it('truncates a long path from the left with …/, the full path in title', () => {
    const long = `${'very-long-directory-name/'.repeat(5)}file.ts`
    view(snap(diff(file(long, 1))))
    const shown = screen.getByTitle(long).textContent ?? ''
    expect(shown.startsWith('…/')).toBe(true)
    expect(shown.endsWith('file.ts')).toBe(true)
    expect(shown.length).toBeLessThan(long.length)
  })

  it('has Expand all files / Collapse all files for the block', () => {
    view(snap(diff(file('a.generated.ts', 2), file('src/ok.ts', 2))))
    fireEvent.click(screen.getByRole('button', { name: 'Expand all files' }))
    expect(bodyOpen('a.generated.ts')).toBe(true)
    expect(bodyOpen('src/ok.ts')).toBe(true)
    fireEvent.click(screen.getByRole('button', { name: 'Collapse all files' }))
    expect(bodyOpen('a.generated.ts')).toBe(false)
    expect(bodyOpen('src/ok.ts')).toBe(false)
  })
})

describe('the checks of a diff', () => {
  const withChecks = (checks: string[]): DetailsBlock => ({
    type: 'diff',
    title: 'Change',
    checks,
    files: [{ path: 'a.ts', hunks: [] }]
  })

  it('is one green line, "N checks passed", that opens the list', () => {
    view(snap(withChecks(['lint — passed', 'tests — passed'])))
    const line = screen.getByRole('button', { name: '2 checks passed' })
    expect(line.className).toContain('text-[var(--ib-ok)]')
    expect(screen.queryByText('lint — passed')).toBeNull()
    fireEvent.click(line)
    expect(screen.getByText('lint — passed')).toBeTruthy()
  })

  it('is red, "N checks · M failed", when any failed', () => {
    view(snap(withChecks(['lint — passed', 'tests — FAILED', 'types — failed'])))
    const line = screen.getByRole('button', { name: '3 checks · 2 failed' })
    expect(line.className).toContain('text-[var(--ib-bad)]')
  })

  it('says "1 check passed" for one', () => {
    view(snap(withChecks(['lint — passed'])))
    expect(screen.getByRole('button', { name: '1 check passed' })).toBeTruthy()
  })
})
