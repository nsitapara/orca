// @vitest-environment happy-dom
import { describe, expect, it, vi } from 'vitest'
import type { AutomationSummary, TickRow } from '../../shared/api-types'
import { listEntries } from '../../shared/job-stages'
import { summary } from './fixtures'
import {
  codeOf,
  loadSort,
  saveSort,
  sortEntries,
  type SortColumn,
  type SortState
} from './automations-sort'

const tick = (at: number): TickRow => ({
  id: at,
  automationId: 'x',
  startedAt: at,
  finishedAt: at,
  dryRun: false,
  status: 'ok',
  error: null,
  counts: {}
})
const mk = (name: string, extra: Partial<AutomationSummary> = {}): AutomationSummary => ({
  ...summary,
  id: name,
  name,
  ...extra
})
const order = (list: AutomationSummary[], sort: SortState): string[] =>
  sortEntries(listEntries(list), sort).map((e) =>
    e.kind === 'job' ? `job:${e.id}` : e.automation.name
  )
const NAME_ASC: SortState = { column: 'name', direction: 'asc' }

describe('codeOf', () => {
  it('reads numeric and letter-prefixed codes from the name', () => {
    expect(codeOf('13 · x')).toEqual({ prefix: '', number: 13 })
    expect(codeOf('M04 · x')).toEqual({ prefix: 'M', number: 4 })
    expect(codeOf('Plain')).toBeNull()
  })
})

describe('sortEntries by name', () => {
  const names = ['Zed', 'M04 · d', '14 · b', 'M01 · c', '01 · a', 'Alpha', '13 · e', '02 · f']
  it('orders codes naturally, then letter codes, then no-code by name', () => {
    expect(
      order(
        names.map((n) => mk(n)),
        NAME_ASC
      )
    ).toEqual(['01 · a', '02 · f', '13 · e', '14 · b', 'M01 · c', 'M04 · d', 'Alpha', 'Zed'])
  })
  it('reverses on desc', () => {
    expect(
      order(
        names.map((n) => mk(n)),
        { column: 'name', direction: 'desc' }
      )[0]
    ).toBe('Zed')
  })
  it('sorts a job by its code and keeps its stages in stage order', () => {
    const job = (id: string, stage: number): AutomationSummary =>
      mk(`${id}-s${stage}`, {
        job: { id, name: 'J', stage, label: 'l', feeds: [] }
      })
    const list = [job('13', 2), mk('14 · z'), job('13', 1), mk('01 · a')]
    for (const direction of ['asc', 'desc'] as const) {
      const entries = sortEntries(listEntries(list), {
        column: 'name',
        direction
      })
      const j = entries.find((e) => e.kind === 'job')
      expect(j && j.kind === 'job' && j.stages.map((s) => s.id)).toEqual(['13-s1', '13-s2'])
    }
    expect(order(list, NAME_ASC)).toEqual(['01 · a', 'job:13', '14 · z'])
  })
})

describe('sortEntries by other columns', () => {
  const cases: [SortColumn, AutomationSummary[], string[], string[]][] = [
    [
      'looksAt',
      [mk('b', { itemKind: 'Pipelines' }), mk('a', { itemKind: 'Linear tickets' })],
      ['a', 'b'],
      ['b', 'a']
    ],
    [
      'schedule',
      [
        mk('manual', { schedule: 'manual' }),
        mk('late', { schedule: 'x', nextTickAt: 200 }),
        mk('soon', { schedule: 'y', nextTickAt: 100 }),
        mk('text', { schedule: '* * * * *' })
      ],
      ['soon', 'late', 'text', 'manual'],
      ['late', 'soon', 'text', 'manual']
    ],
    [
      'lastTick',
      [mk('never'), mk('old', { lastTick: tick(100) }), mk('new', { lastTick: tick(200) })],
      ['new', 'old', 'never'],
      ['old', 'new', 'never']
    ],
    [
      'status',
      [mk('off', { enabled: false }), mk('on', { enabled: true })],
      ['on', 'off'],
      ['off', 'on']
    ]
  ]
  it.each(cases)('%s, both directions', (column, list, asc, desc) => {
    expect(order(list, { column, direction: 'asc' })).toEqual(asc)
    expect(order(list, { column, direction: 'desc' })).toEqual(desc)
  })
})

describe('sort persistence', () => {
  it('round-trips, and falls back to name ascending on bad data', () => {
    saveSort({ column: 'status', direction: 'desc' })
    expect(loadSort()).toEqual({ column: 'status', direction: 'desc' })
    localStorage.setItem('pilot.automations.sort', '{nope')
    expect(loadSort()).toEqual(NAME_ASC)
  })
  it('survives a throwing localStorage', () => {
    const boom = (): never => {
      throw new Error('denied')
    }
    const spies = [
      vi.spyOn(Storage.prototype, 'getItem').mockImplementation(boom),
      vi.spyOn(Storage.prototype, 'setItem').mockImplementation(boom)
    ]
    expect(loadSort()).toEqual(NAME_ASC)
    expect(() => saveSort({ column: 'name', direction: 'desc' })).not.toThrow()
    spies.forEach((s) => s.mockRestore())
  })
})
