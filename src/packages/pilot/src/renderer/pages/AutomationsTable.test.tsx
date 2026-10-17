// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AutomationListPayload, AutomationSummary, TickRow } from '../../shared/api-types'
import { stepAt, testRun } from '../../shared/run-views/__fixtures__/runs'
import { LOCAL_NAMED, MINI } from '../hosts/__fixtures__/hosts'
import type { PilotHostRef } from '../hosts/pilot-host'
import { resetPilotHostsFeed, setPilotHostsForTests } from '../hosts/pilot-hosts-feed'
import { closeRunPanel, openRunPanel } from '../run-views/run-panel-state'
import { AutomationsTable } from './AutomationsTable'
import {
  pilotAutomationTab,
  pilotAutomationsView,
  pilotOpenAutomation,
  showAutomationsPage,
  takeActivityFilter
} from './automations-view'
import { summary } from './fixtures'

const NOW = Date.UTC(2026, 9, 13, 18, 0)
const tick = (automationId: string, minutesAgo: number, counts: TickRow['counts']): TickRow => ({
  id: minutesAgo,
  automationId,
  startedAt: NOW - minutesAgo * 60_000,
  finishedAt: NOW - minutesAgo * 60_000 + 1000,
  status: 'ok',
  error: null,
  counts
})
const STAGE_1: AutomationSummary = {
  ...summary,
  id: 'dev-e2e-fix',
  name: '13 · Fix red hourly e2e on dev',
  enabled: false,
  schedule: '5,35 * * * *',
  itemKind: 'Pipelines',
  lastTick: tick('dev-e2e-fix', 3, { notdue: 1 }),
  job: {
    id: '13',
    name: 'Fix red hourly e2e on dev',
    stage: 1,
    label: 'Open or update the ticket',
    feeds: [
      {
        to: 'dev-e2e-fix-start',
        pass: null,
        run: 'next_schedule',
        when: 'success',
        caption: 'the tickets it opens',
        trust: 'shell'
      }
    ]
  }
}
const STAGE_2: AutomationSummary = {
  ...summary,
  id: 'dev-e2e-fix-start',
  name: '13 · Start fix sessions for red e2e tickets',
  enabled: true,
  schedule: '6,36 * * * *',
  itemKind: 'Linear tickets',
  lastTick: tick('dev-e2e-fix-start', 2, {}),
  job: {
    id: '13',
    name: null,
    stage: 2,
    label: 'Start a fix session per ticket',
    feeds: []
  }
}
const SOLO: AutomationSummary = { ...summary, id: 'docker-prune', name: '07 · Clean Docker' }
const payload = (automations: AutomationSummary[]): AutomationListPayload => ({
  automations,
  errors: [],
  peopleError: null,
  missingDirs: []
})

function renderTable(automations: AutomationSummary[]) {
  const onOpen = vi.fn()
  const onOpenJob = vi.fn()
  const onToggle = vi.fn(() => Promise.resolve())
  render(
    <AutomationsTable
      payload={payload(automations)}
      now={NOW}
      onOpen={onOpen}
      onOpenJob={onOpenJob}
      onToggle={onToggle}
    />
  )
  return { onOpen, onOpenJob, onToggle }
}

describe('AutomationsTable: a job of several automations', () => {
  beforeEach(() => localStorage.clear())
  afterEach(cleanup)

  it('shows 13 as one row with a stages chip, then its stages indented in stage order', () => {
    renderTable([SOLO, STAGE_2, STAGE_1])
    const rows = screen
      .getAllByRole('button')
      .filter((r) => !r.closest('[role="row"], ul') && r.getAttribute('aria-expanded') === null)
    expect(rows.map((r) => r.getAttribute('aria-label') ?? r.textContent)).toEqual([
      expect.stringContaining('07 · Clean Docker'),
      'Job 13 · Fix red hourly e2e on dev, 2 stages',
      'Stage 1 Open or update the ticket',
      'Stage 2 Start a fix session per ticket'
    ])
    const job = within(rows[1].closest('div[class*="cursor-pointer"]') as HTMLElement)
    expect(job.getByText('2 stages')).toBeTruthy()
    // combined: partly on because only stage 2 is; the newest tick is stage 2's
    expect(job.getByText('Partly on')).toBeTruthy()
    expect(job.getByText('2 min ago · 0 checked')).toBeTruthy()
    const first = within(rows[2].closest('div[class*="cursor-pointer"]') as HTMLElement)
    expect(first.getByText('5,35 * * * *')).toBeTruthy()
    expect(first.getByText('3 min ago · 1 checked · 1 not due')).toBeTruthy()
    expect(first.getByText('Paused')).toBeTruthy()
    expect(
      within(rows[3].closest('div[class*="cursor-pointer"]') as HTMLElement).getByText(
        '6,36 * * * *'
      )
    ).toBeTruthy()
  })

  it('opens the job page from the job row, and a stage’s own page from its row', () => {
    const { onOpen, onOpenJob } = renderTable([STAGE_1, STAGE_2])
    fireEvent.click(
      screen.getByRole('button', { name: 'Job 13 · Fix red hourly e2e on dev, 2 stages' })
    )
    expect(onOpenJob).toHaveBeenCalledWith('13')
    fireEvent.click(screen.getByRole('button', { name: 'Stage 2 Start a fix session per ticket' }))
    expect(onOpen).toHaveBeenCalledWith('dev-e2e-fix-start')
  })

  it('keeps an automation without a job one plain row', () => {
    const { onOpen } = renderTable([SOLO])
    expect(screen.queryByText(/stages?$/)).toBeNull()
    expect(screen.queryByRole('button', { name: /stages$/ })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: /Clean Docker/ }))
    expect(onOpen).toHaveBeenCalledWith('docker-prune')
  })
})

describe('AutomationsTable: the Status switch', () => {
  beforeEach(() => localStorage.clear())
  afterEach(cleanup)
  const OFF_1 = { ...STAGE_1, enabled: false }
  const OFF_2 = { ...STAGE_2, enabled: false }

  it.each([
    ['a plain automation off', [SOLO], '07 · Clean Docker: turn off', ['docker-prune'], false],
    [
      'a stage on',
      [STAGE_1, STAGE_2],
      'Stage 1 Open or update the ticket: turn on',
      ['dev-e2e-fix'],
      true
    ],
    [
      'a partly-on job off, only its on stages',
      [STAGE_1, STAGE_2],
      /^Job 13 .*: turn off$/,
      ['dev-e2e-fix-start'],
      false
    ],
    [
      'an off job on, every stage',
      [OFF_1, OFF_2],
      /^Job 13 .*: turn on$/,
      ['dev-e2e-fix', 'dev-e2e-fix-start'],
      true
    ]
  ] as const)('turns %s without opening the row', async (_case, rows, name, ids, enabled) => {
    const { onOpen, onOpenJob, onToggle } = renderTable([...rows])
    const toggle = screen.getByRole('switch', { name })
    fireEvent.click(toggle)
    expect(onToggle).toHaveBeenCalledWith(ids, enabled)
    expect(onOpen).not.toHaveBeenCalled()
    expect(onOpenJob).not.toHaveBeenCalled()
    // shows the state asked for while the call runs
    expect(toggle.getAttribute('aria-checked')).toBe(String(enabled))
    await waitFor(() => expect(toggle.hasAttribute('disabled')).toBe(false))
  })
})

const stageNames = (): string[] =>
  screen
    .queryAllByRole('button', { name: /^Stage / })
    .map((b) => b.getAttribute('aria-label') ?? '')

describe('AutomationsTable: folding a job', () => {
  beforeEach(() => localStorage.clear())
  afterEach(() => {
    cleanup()
    vi.restoreAllMocks()
  })

  it('toggles the stages with the chevron without opening the job, and remembers it', () => {
    const { onOpenJob } = renderTable([STAGE_1, STAGE_2])
    expect(stageNames()).toHaveLength(2)
    const hide = screen.getByRole('button', { name: 'Hide stages' })
    expect(hide.getAttribute('aria-expanded')).toBe('true')
    fireEvent.click(hide)
    expect(onOpenJob).not.toHaveBeenCalled()
    expect(stageNames()).toHaveLength(0)
    const show = screen.getByRole('button', { name: 'Show stages' })
    expect(show.getAttribute('aria-expanded')).toBe('false')
    cleanup()
    renderTable([STAGE_1, STAGE_2])
    expect(stageNames()).toHaveLength(0)
    fireEvent.click(screen.getByRole('button', { name: 'Show stages' }))
    expect(stageNames()).toHaveLength(2)
  })

  it('is a real button, so Enter and Space toggle it natively', () => {
    renderTable([STAGE_1, STAGE_2])
    const chevron = screen.getByRole('button', { name: 'Hide stages' })
    expect(chevron.tagName).toBe('BUTTON')
    expect(chevron.getAttribute('type')).toBe('button')
    expect(chevron.tabIndex).toBe(0)
  })

  it('still works when localStorage throws', () => {
    const boom = (): never => {
      throw new Error('denied')
    }
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(boom)
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(boom)
    vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(boom)
    renderTable([STAGE_1, STAGE_2])
    expect(stageNames()).toHaveLength(2)
    fireEvent.click(screen.getByRole('button', { name: 'Hide stages' }))
    expect(stageNames()).toHaveLength(0)
  })

  it('opens the job from the row’s other cells too', () => {
    const { onOpenJob } = renderTable([STAGE_1, STAGE_2])
    fireEvent.click(screen.getAllByText('2 min ago · 0 checked')[0])
    expect(onOpenJob).toHaveBeenCalledWith('13')
  })
})

describe('AutomationsTable: sorting', () => {
  beforeEach(() => localStorage.clear())
  afterEach(cleanup)
  const rowNames = (): string[] =>
    screen
      .getAllByRole('button')
      .filter((b) => !b.closest('[role="row"], ul') && b.getAttribute('aria-expanded') === null)
      .map((b) => b.getAttribute('aria-label') ?? b.textContent ?? '')

  it('defaults to natural code order and toggles with aria-sort, remembering the choice', () => {
    const list = ['M01 · c', '14 · b', 'Zed', '02 · a'].map((n) => ({ ...summary, id: n, name: n }))
    renderTable(list)
    expect(rowNames().map((n) => n.slice(0, 3))).toEqual(['02 ', '14 ', 'M01', 'Zed'])
    const header = screen.getByRole('columnheader', { name: /Name/ })
    expect(header.getAttribute('aria-sort')).toBe('ascending')
    fireEvent.click(within(header).getByRole('button'))
    expect(header.getAttribute('aria-sort')).toBe('descending')
    expect(rowNames()[0]).toContain('Zed')
    cleanup()
    renderTable(list)
    expect(screen.getByRole('columnheader', { name: /Name/ }).getAttribute('aria-sort')).toBe(
      'descending'
    )
  })

  it('keeps stages under their job whatever the sort', () => {
    renderTable([STAGE_2, SOLO, STAGE_1])
    fireEvent.click(screen.getByRole('button', { name: /Status/ }))
    const names = rowNames()
    const i = names.findIndex((n) => n.startsWith('Job 13'))
    expect(names.slice(i + 1, i + 3)).toEqual([
      'Stage 1 Open or update the ticket',
      'Stage 2 Start a fix session per ticket'
    ])
  })
})

const running = (id: string, automationId: string) =>
  testRun({ id, automationId, steps: [stepAt(0, 'fix', 'running')] })

describe('AutomationsTable: the Runs strip', () => {
  beforeEach(() => localStorage.clear())
  afterEach(() => {
    cleanup()
    closeRunPanel()
    showAutomationsPage()
  })

  it("shows each automation's runs as a strip: what it looks at, then each step", () => {
    renderTable([SOLO])
    const strip = screen.getByRole('list', { name: '07 · Clean Docker runs' })
    expect(
      within(strip)
        .getAllByRole('button')
        .map((b) => b.getAttribute('aria-label'))
    ).toEqual(['Pilot · MRs · 1 gate', 'Agent · 1 fix'])
  })

  it('opens the one run a lit chip is lit for, Activity when it is lit for several, and How it runs when it is not', () => {
    const first = renderTable([{ ...SOLO, live: [running('a', 'docker-prune')] }])
    fireEvent.click(screen.getByRole('button', { name: 'Agent · 1 fix · Running' }))
    expect(openRunPanel()).toEqual({ runId: 'a', part: 'step:0' })
    expect(first.onOpen).not.toHaveBeenCalled()
    cleanup()
    renderTable([{ ...SOLO, live: [running('a', 'docker-prune'), running('b', 'docker-prune')] }])
    const lit = screen.getByRole('button', { name: 'Agent · 1 fix · Running' })
    expect(lit.textContent).toContain('2')
    fireEvent.click(lit)
    expect([pilotAutomationsView(), takeActivityFilter()]).toEqual(['activity', ['docker-prune']])
    fireEvent.click(screen.getByRole('button', { name: 'Pilot · MRs · 1 gate' }))
    expect([pilotOpenAutomation(), pilotAutomationTab()]).toEqual(['docker-prune', 'how'])
  })

  it("shows a job row's running stage, then +1 stage", () => {
    renderTable([STAGE_1, { ...STAGE_2, live: [running('r', 'dev-e2e-fix-start')] }])
    // stage 1 shares the job's title in this fixture, so the job row's strip is the first
    const [strip] = screen.getAllByRole('list', { name: '13 · Fix red hourly e2e on dev runs' })
    expect(within(strip).getByRole('button', { name: 'Agent · 1 fix · Running' })).toBeTruthy()
    expect(within(strip).getByText('+1 stage')).toBeTruthy()
  })
})

describe('AutomationsTable on more than one machine', () => {
  beforeEach(() => {
    localStorage.clear()
    setPilotHostsForTests([LOCAL_NAMED, MINI])
  })
  afterEach(() => {
    cleanup()
    resetPilotHostsFeed()
  })
  const on = (a: AutomationSummary, hosts: PilotHostRef[]) => ({ ...a, hosts })
  const rowOf = (name: RegExp) => {
    const row = screen
      .getByRole('button', { name })
      .closest<HTMLElement>('div[class*="cursor-pointer"]')
    if (!row) {
      throw new Error(`no row for ${name}`)
    }
    return within(row)
  }

  it.each<[string, AutomationSummary[], RegExp]>([
    ['a plain row', [on(SOLO, [LOCAL_NAMED, MINI])], /Clean Docker/],
    ["a job's row, from its stages", [on(STAGE_1, [LOCAL_NAMED]), on(STAGE_2, [MINI])], /^Job 13 /],
    ['a stage row', [on(STAGE_1, [LOCAL_NAMED, MINI]), on(STAGE_2, [MINI])], /^Stage 1 /]
  ])('names every machine a row is loaded on: %s', (_w, rows, name) => {
    renderTable(rows)
    expect(rowOf(name).getByText('MacBook')).toBeTruthy()
    expect(rowOf(name).getByText('Mac mini')).toBeTruthy()
  })
})
