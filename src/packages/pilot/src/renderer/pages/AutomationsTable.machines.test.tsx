// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AutomationSummary } from '../../shared/api-types'
import { LOCAL_NAMED, MINI, MINI_OFFLINE } from '../hosts/__fixtures__/hosts'
import type { ListedMachines } from '../hosts/merge-automations'
import { LOCAL_PILOT_HOST, type PilotHostEntry } from '../hosts/pilot-host'
import { resetPilotHostsFeed, setPilotHostsForTests } from '../hosts/pilot-hosts-feed'
import { summary } from './fixtures'

const pilotRpc = vi.fn()
vi.mock('../api', () => ({ pilotRpc: (...args: unknown[]) => pilotRpc(...args) }))

import { AutomationsTable } from './AutomationsTable'
import { HowItRuns } from './HowItRuns'

const SOLO: AutomationSummary = {
  ...summary,
  id: 'docker-prune',
  name: '07 · Clean Docker',
  schedule: '0 3 * * *'
}
const LINUX = { ...SOLO, runsOn: 'Linux box' }
const ON_MINI = { ...SOLO, runsOn: 'Mac mini' }
const stage = (n: number, runsOn: string | null): AutomationSummary => ({
  ...summary,
  id: `stage-${n}`,
  name: `13 · stage ${n}`,
  runsOn,
  job: { id: '13', name: 'Fix red e2e', stage: n, label: `Work ${n}`, feeds: [] }
})
const TWO: ListedMachines = { listedHosts: [LOCAL_NAMED, MINI], failedHosts: [] }

function renderTable(automations: AutomationSummary[], machines?: ListedMachines) {
  const onToggle = vi.fn(() => Promise.resolve())
  render(
    <AutomationsTable
      payload={{ automations }}
      now={0}
      machines={machines}
      onOpen={() => {}}
      onOpenJob={() => {}}
      onToggle={onToggle}
    />
  )
  return { onToggle }
}

// A line's text and tone.
function lineOf(line: HTMLElement | null): [string | null, string | undefined] | null {
  if (!line) {
    return null
  }
  const tone = ['text-destructive', 'text-muted-foreground'].find((c) => line.classList.contains(c))
  return [line.textContent, tone]
}

const rowOf = (name: RegExp) => {
  const row = screen
    .getByRole('button', { name })
    .closest<HTMLElement>('div[class*="cursor-pointer"]')
  if (!row) {
    throw new Error(`no row for ${name}`)
  }
  return within(row)
}
const refusedLine = () =>
  lineOf(screen.queryByText(/^(Automations that run on |Waiting for )/, { selector: 'p' }))

describe('AutomationsTable: where a pinned job runs', () => {
  beforeEach(() => localStorage.clear())
  afterEach(() => {
    cleanup()
    resetPilotHostsFeed()
  })

  it.each<[string, PilotHostEntry[], AutomationSummary[], RegExp, [string, string] | null]>([
    ['nothing for an unpinned row', [LOCAL_NAMED, MINI], [SOLO], /Clean Docker/, null],
    [
      'the machine as written, on this machine alone',
      [LOCAL_PILOT_HOST],
      [{ ...SOLO, runsOn: 'mac mini' }],
      /Clean Docker/,
      ['Runs on mac mini', 'text-muted-foreground']
    ],
    [
      'the machine as it names itself, when connected',
      [LOCAL_NAMED, MINI],
      [{ ...SOLO, runsOn: 'mac mini' }],
      /Clean Docker/,
      ['Runs on Mac mini', 'text-muted-foreground']
    ],
    [
      'that it is unreachable, on a stage row',
      [LOCAL_NAMED, MINI_OFFLINE],
      [stage(1, 'Mac mini'), stage(2, null)],
      /^Stage 1 /,
      ["Runs on Mac mini · can't be reached", 'text-destructive']
    ],
    [
      'that no connected Pilot has the name',
      [LOCAL_NAMED, MINI],
      [LINUX],
      /Clean Docker/,
      ['Runs on Linux box · no connected Pilot has that name', 'text-destructive']
    ]
  ])('shows where a pinned job runs in its row: %s', (_w, hosts, rows, name, expected) => {
    setPilotHostsForTests(hosts)
    renderTable(rows)
    expect(lineOf(rowOf(name).queryByText(/^Runs on /))).toEqual(expected)
  })

  // The line wraps in its own cell, so a long name can't take the name column's room.
  it('keeps the line inside the schedule cell', () => {
    setPilotHostsForTests([LOCAL_NAMED, MINI])
    renderTable([LINUX])
    const line = rowOf(/Clean Docker/).getByText(/^Runs on /)
    expect(line.classList.contains('break-words')).toBe(true)
    expect(line.parentElement?.classList.contains('min-w-0')).toBe(true)
    expect(within(line.parentElement ?? document.body).getByText('0 3 * * *')).toBeTruthy()
  })
})

describe('AutomationsTable: rows that run on a machine Pilot lacks', () => {
  beforeEach(() => localStorage.clear())
  afterEach(() => {
    cleanup()
    resetPilotHostsFeed()
  })

  it.each<[string, ListedMachines, AutomationSummary, string | null, [string, string] | null]>([
    [
      'refuses a row whose runs_on names no listed machine, saying so above the table',
      TWO,
      LINUX,
      "No connected Pilot is named Linux box, so this automation can't be changed from here.",
      ["Automations that run on Linux box can't be changed from here.", 'text-destructive']
    ],
    [
      'switches it on this machine alone',
      { listedHosts: [LOCAL_NAMED], failedHosts: [] },
      LINUX,
      null,
      null
    ],
    [
      "says it waits for its machine's first list",
      { ...TWO, failedHosts: [MINI], pendingHosts: new Set([MINI.key]) },
      ON_MINI,
      "Waiting for Mac mini's list…",
      ["Waiting for Mac mini's list…", 'text-muted-foreground']
    ],
    [
      "names its machine when it isn't answering",
      { ...TWO, failedHosts: [MINI] },
      ON_MINI,
      "Mac mini isn't answering, so this automation can't be changed from here right now.",
      ["Automations that run on Mac mini can't be changed from here.", 'text-destructive']
    ]
  ])('%s', (_w, machines, row, title, line) => {
    const { onToggle } = renderTable([row], machines)
    const toggle = screen.getByRole('switch', { name: '07 · Clean Docker: turn off' })
    expect([toggle.hasAttribute('disabled'), toggle.getAttribute('title')]).toEqual([
      title !== null,
      title
    ])
    fireEvent.click(toggle)
    expect(onToggle).toHaveBeenCalledTimes(title === null ? 1 : 0)
    expect(refusedLine()).toEqual(line)
  })

  it("refuses a job's switch while a stage names no listed machine, naming it once", () => {
    setPilotHostsForTests([LOCAL_NAMED, MINI])
    renderTable([stage(1, 'Linux box'), stage(2, 'linux box')], TWO)
    const job = screen.getByRole('switch', { name: /^Job 13 .*: turn off$/ })
    expect(job.getAttribute('title')).toBe(
      "No connected Pilot is named Linux box, so this job can't be changed from here."
    )
    expect(refusedLine()).toEqual([
      "Automations that run on Linux box can't be changed from here.",
      'text-destructive'
    ])
  })
})

describe('How it runs: where a pinned job runs', () => {
  afterEach(() => {
    cleanup()
    resetPilotHostsFeed()
    pilotRpc.mockReset()
  })

  it.each<[string, PilotHostEntry[], string | null, [string, string] | null]>([
    ['nothing without runs_on', [LOCAL_NAMED, MINI], null, null],
    [
      'the machine, on this machine alone',
      [LOCAL_NAMED],
      'Linux box',
      ['Runs on Linux box', 'text-muted-foreground']
    ],
    [
      'that it is unreachable',
      [LOCAL_NAMED, MINI_OFFLINE],
      'Mac mini',
      ["Runs on Mac mini · can't be reached", 'text-destructive']
    ]
  ])('says in its facts %s', (_w, hosts, runsOn, expected) => {
    setPilotHostsForTests(hosts)
    pilotRpc.mockResolvedValue({ live: [], ticks: [], loose: [], reach: null })
    const { container } = render(<HowItRuns summary={{ ...summary, runsOn }} />)
    const facts = container.querySelector<HTMLElement>('dl')
    if (!facts) {
      throw new Error('no facts')
    }
    expect(lineOf(within(facts).queryByText(/^Runs on /))).toEqual(expected)
  })
})
