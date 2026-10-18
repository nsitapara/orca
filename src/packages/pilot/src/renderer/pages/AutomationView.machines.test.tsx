// @vitest-environment happy-dom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { AutomationSummary } from '../../shared/api-types'
import { byHost, LOCAL_NAMED, MINI } from '../hosts/__fixtures__/hosts'
import type { PilotHostEntry } from '../hosts/pilot-host'
import { resetPilotHostsFeed, setPilotHostsForTests } from '../hosts/pilot-hosts-feed'
import { resetAutomationsFeed } from '../run-views/automations-feed'
import { detail, summary } from './fixtures'

const pilotRpc = vi.fn()
vi.mock('../api', () => ({ pilotRpc: (...args: unknown[]) => pilotRpc(...args) }))

import { AutomationView } from './AutomationView'

const TICK = { tickId: 12, status: 'ok', error: null, decisions: [] }
const OFF = (host: PilotHostEntry): PilotHostEntry => ({ ...host, schedulerOn: false })

// A machine's answers: its list, the detail, no Activity, and `tick` for a tick (an Error is thrown).
const answersFrom =
  (automations: AutomationSummary[], tick: unknown = TICK) =>
  (method: string) => {
    if (method === 'pilot.automations.list') {
      return { automations, errors: [], peopleError: null, missingDirs: [] }
    }
    if (method === 'pilot.activity.list') {
      return { live: [], ticks: [], loose: [], reach: null }
    }
    if (method === 'pilot.automations.get') {
      return detail
    }
    if (tick instanceof Error) {
      throw tick
    }
    return tick
  }
const calls = (method: string) => pilotRpc.mock.calls.filter((c) => c[0] === method)
const picker = () => screen.getByRole('combobox', { name: 'Machine' })
const pick = async (name: string) => {
  fireEvent.keyDown(picker(), { key: 'ArrowDown' })
  fireEvent.click(await screen.findByRole('option', { name }))
}

async function openRunNow(hosts: PilotHostEntry[], answers: Parameters<typeof byHost>[0]) {
  setPilotHostsForTests(hosts)
  pilotRpc.mockImplementation(byHost(answers))
  render(<AutomationView id="fix-ci" onBack={() => {}} onOpenJob={() => {}} />)
  fireEvent.click(await screen.findByRole('button', { name: 'Run now' }))
}

describe('Run now on more than one machine', () => {
  afterEach(() => {
    cleanup()
    pilotRpc.mockReset()
    localStorage.clear()
    resetAutomationsFeed()
    resetPilotHostsFeed()
  })

  it('asks which machine, defaulting to runs_on, and starts the run there', async () => {
    const pinned = [{ ...summary, runsOn: 'Mac mini' }]
    await openRunNow([LOCAL_NAMED, MINI], {
      local: answersFrom(pinned),
      mini: answersFrom(pinned)
    })
    expect(picker().textContent).toContain('Mac mini')
    expect(
      screen.getByText('Start agents on Mac mini for items that pass the checks?')
    ).toBeTruthy()
    expect(calls('pilot.automations.tickNow')).toHaveLength(0)
    fireEvent.click(screen.getByRole('button', { name: 'Confirm' }))
    expect(await screen.findByText('On Mac mini: Tick 12 · ok')).toBeTruthy()
    expect(calls('pilot.automations.tickNow')).toEqual([
      ['pilot.automations.tickNow', { id: 'fix-ci' }, { timeoutMs: 180_000, target: MINI.target }]
    ])
  })

  it('starts it on the machine picked instead of the default', async () => {
    await openRunNow([LOCAL_NAMED, MINI], {
      local: answersFrom([summary]),
      mini: answersFrom([summary])
    })
    expect(picker().textContent).toContain('MacBook')
    fireEvent.keyDown(picker(), { key: 'ArrowDown' })
    fireEvent.click(await screen.findByRole('option', { name: 'Mac mini' }))
    expect(
      screen.getByText('Start agents on Mac mini for items that pass the checks?')
    ).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Confirm' }))
    expect(await screen.findByText('On Mac mini: Tick 12 · ok')).toBeTruthy()
    expect(calls('pilot.automations.tickNow')).toEqual([
      ['pilot.automations.tickNow', { id: 'fix-ci' }, { timeoutMs: 180_000, target: MINI.target }]
    ])
  })

  it("lists a machine that can't start it, disabled, with its reason", async () => {
    await openRunNow([LOCAL_NAMED, OFF(MINI)], {
      local: answersFrom([summary]),
      mini: answersFrom([summary])
    })
    fireEvent.keyDown(picker(), { key: 'ArrowDown' })
    const off = await screen.findByRole('option', { name: 'Mac mini · scheduler off' })
    expect(off.getAttribute('aria-disabled')).toBe('true')
  })

  it('opens on the default machine and stays there when the default changes', async () => {
    const pinned = [{ ...summary, runsOn: 'Mac mini' }]
    await openRunNow([LOCAL_NAMED, OFF(MINI)], {
      local: answersFrom(pinned),
      mini: answersFrom(pinned)
    })
    expect(picker().textContent).toContain('MacBook')
    act(() => setPilotHostsForTests([LOCAL_NAMED, MINI]))
    expect(picker().textContent).toContain('MacBook')
    fireEvent.click(screen.getByRole('button', { name: 'Confirm' }))
    expect(await screen.findByText('On MacBook: Tick 12 · ok')).toBeTruthy()
    expect(calls('pilot.automations.tickNow')).toEqual([
      ['pilot.automations.tickNow', { id: 'fix-ci' }, { timeoutMs: 180_000 }]
    ])
  })

  it('keeps a pick that can no longer start it, saying why, with nothing to confirm', async () => {
    await openRunNow([LOCAL_NAMED, MINI], {
      local: answersFrom([summary]),
      mini: answersFrom([summary])
    })
    await pick('Mac mini')
    act(() => setPilotHostsForTests([LOCAL_NAMED, OFF(MINI)]))
    expect(picker().textContent).toContain('Mac mini')
    expect(screen.getByText("Pilot's scheduler is off on Mac mini")).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Confirm' })).toBeNull()
    expect(calls('pilot.automations.tickNow')).toEqual([])
  })

  it.each<[string, () => Promise<unknown>]>([
    ['Cancel', async () => fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))],
    [
      'a finished run',
      async () => {
        fireEvent.click(screen.getByRole('button', { name: 'Confirm' }))
        await screen.findByText('On Mac mini: Tick 12 · ok')
      }
    ]
  ])('starts again from the default after %s', async (_w, close) => {
    await openRunNow([LOCAL_NAMED, MINI], {
      local: answersFrom([summary]),
      mini: answersFrom([summary])
    })
    await pick('Mac mini')
    await close()
    fireEvent.click(screen.getByRole('button', { name: 'Run now' }))
    expect(picker().textContent).toContain('MacBook')
    expect(screen.getByText('Start agents on MacBook for items that pass the checks?')).toBeTruthy()
  })

  it('shows why, and sends nothing, when no machine can start it', async () => {
    await openRunNow([OFF(LOCAL_NAMED), OFF(MINI)], {
      local: answersFrom([summary]),
      mini: answersFrom([summary])
    })
    expect(
      await screen.findByText(
        "Pilot's scheduler is off on MacBook · Pilot's scheduler is off on Mac mini"
      )
    ).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Confirm' })).toBeNull()
    expect(calls('pilot.automations.tickNow')).toEqual([])
  })

  it("shows the machine's own refusal beside the button, naming the machine", async () => {
    const pinned = [{ ...summary, runsOn: 'Mac mini' }]
    await openRunNow([LOCAL_NAMED, { ...MINI, schedulerOn: null }], {
      local: answersFrom(pinned),
      mini: answersFrom(pinned, new Error("Pilot's scheduler isn't running in this process"))
    })
    fireEvent.click(screen.getByRole('button', { name: 'Confirm' }))
    expect(
      await screen.findByText("On Mac mini: Pilot's scheduler isn't running in this process")
    ).toBeTruthy()
  })

  it('asks nothing when only one machine has the job, but its line names that machine', async () => {
    await openRunNow([LOCAL_NAMED, MINI], {
      local: answersFrom([summary]),
      mini: answersFrom([])
    })
    expect(screen.queryByRole('combobox', { name: 'Machine' })).toBeNull()
    expect(screen.getByText('Start agents for items that pass the checks?')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Confirm' }))
    expect(await screen.findByText('On MacBook: Tick 12 · ok')).toBeTruthy()
    expect(calls('pilot.automations.tickNow')).toEqual([
      ['pilot.automations.tickNow', { id: 'fix-ci' }, { timeoutMs: 180_000 }]
    ])
  })
})
