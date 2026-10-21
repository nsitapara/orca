// @vitest-environment happy-dom
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { CapacityPayload, CapacityRun } from '../../../shared/api-types-capacity'
import { clearPendingInboxCard, pendingInboxCard } from '../automations-view'
import { capacity } from './__fixtures__/capacity'

const pilotRpc = vi.fn()
vi.mock('../../api', () => ({ pilotRpc: (...args: unknown[]) => pilotRpc(...args) }))
const activateRunTab = vi.fn()
vi.mock('../../activity-tabs/activate-run-tab', () => ({
  activateRunTab: (...args: unknown[]) => activateRunTab(...args)
}))

import { RunningPage } from './RunningPage'

// The page's poll answers `current`.
function serve(current: CapacityPayload): void {
  pilotRpc.mockImplementation(async () => current)
}

async function shown(): Promise<void> {
  render(<RunningPage />)
  await act(async () => {})
}

async function click(name: string): Promise<void> {
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name }))
  })
}

afterEach(() => {
  cleanup()
  pilotRpc.mockReset()
})

describe("A running run's Stop and Show tab on Running", () => {
  it("stops a running run only after a yes, and says why when Pilot couldn't", async () => {
    const why = "Couldn't close terminal t1: its process is live"
    serve(capacity())
    const served = pilotRpc.getMockImplementation()
    pilotRpc.mockImplementation(async (method: string, params?: unknown) =>
      method === 'pilot.runs.stop' ? { stopped: false, reason: why } : served?.(method, params)
    )
    const stops = () => pilotRpc.mock.calls.filter(([method]) => method === 'pilot.runs.stop')
    await shown()
    const running = within(screen.getByRole('region', { name: 'Running now' }))
    await act(async () => fireEvent.click(running.getByRole('button', { name: 'Stop' })))
    const dialog = within(screen.getByRole('dialog', { name: 'Stop this run?' }))
    const asks = "Its agent's tab closes. You can pick it up again from Recently finished."
    expect(dialog.getByText(asks)).toBeTruthy()
    await click('Cancel')
    expect([screen.queryByRole('dialog'), stops()]).toEqual([null, []])
    await act(async () => fireEvent.click(running.getByRole('button', { name: 'Stop' })))
    await click('Stop run')
    expect(stops()).toEqual([['pilot.runs.stop', { runId: 'r1' }]])
    expect(await running.findByText(why)).toBeTruthy()
  })

  it("shows the run's tab only when the run has one, and says when it is closed", async () => {
    const tab = { worktreePath: '/wt/web-1', tabId: 'tab-1' }
    serve(capacity({ running: [{ ...capacity().running[0], tab }] }))
    await shown()
    activateRunTab.mockReturnValue(false)
    await click('Show tab')
    expect(activateRunTab).toHaveBeenCalledWith(tab)
    expect(screen.getByText('Its tab is closed')).toBeTruthy()
  })
})

describe("A running run's answer badge, step line and Stop on Running", () => {
  const running = () => within(screen.getByRole('region', { name: 'Running now' }))
  const step = (over: Partial<NonNullable<CapacityRun['step']>> = {}) => ({
    name: 'answers',
    kind: 'agent' as const,
    skill: 'ui-qa',
    mode: 'answers',
    ...over
  })

  it.each([
    ['an answer run', true as const, 1],
    ['another run', undefined, 0]
  ])('shows From your answer on %s only when it applies one', async (_name, fromAnswer, shown_) => {
    serve(capacity({ running: [{ ...capacity().running[0], fromAnswer }] }))
    await shown()
    expect(running().queryAllByText('From your answer')).toHaveLength(shown_)
  })

  it('lists the cards an answer run applies with your answer, and a title opens its card', async () => {
    const answering = [
      { id: 'c1', title: 'Use a middot between classifications?', answer: 'yes, middot' },
      { id: 'c2', title: 'Point mr-create at the report page?', answer: null }
    ]
    serve(capacity({ running: [{ ...capacity().running[0], fromAnswer: true, answering }] }))
    await shown()
    const cards = within(running().getByRole('list', { name: 'Answering' }))
    expect(cards.getAllByRole('listitem').map((li) => li.textContent)).toEqual([
      'Use a middot between classifications?You: yes, middot',
      'Point mr-create at the report page?'
    ])
    fireEvent.click(cards.getByRole('button', { name: 'Point mr-create at the report page?' }))
    expect(pendingInboxCard()).toBe('c2')
    clearPendingInboxCard()
  })

  it.each([
    ['skill and mode', step(), 'Step answers · ui-qa · answers mode'],
    ['neither', step({ skill: null, mode: null }), 'Step answers'],
    ['a skill only', step({ mode: null }), 'Step answers · ui-qa']
  ])('names the step it runs with %s', async (_name, stepOf, text) => {
    serve(capacity({ running: [{ ...capacity().running[0], step: stepOf }] }))
    await shown()
    expect(running().getByText(text)).toBeTruthy()
  })

  it('shows no step line for a card from an older Pilot', async () => {
    serve(capacity())
    await shown()
    expect(running().queryByText(/^Step /)).toBeNull()
  })

  // Why: counted is false when the definition is unloaded, the stuck card Stop exists for.
  it.each([
    ['an agent step', { step: step() }, 1],
    ['no step (an older Pilot)', {}, 1],
    ['an unloaded definition on an agent step', { step: step(), counted: false }, 1],
    ['a shell step', { step: step({ kind: 'shell' }) }, 0]
  ])('offers Stop on a run on %s', async (_name, over, stops) => {
    serve(capacity({ running: [{ ...capacity().running[0], ...over }] }))
    await shown()
    expect(running().queryAllByRole('button', { name: 'Stop' })).toHaveLength(stops)
  })
})

describe("A running run's Stop dialog text on Running", () => {
  const usual = "Its agent's tab closes. You can pick it up again from Recently finished."
  const answered = "Its agent's tab closes, and the cards it was answering go back to your Inbox."
  it.each<[string, true | undefined, string]>([
    ['an answer run', true, answered],
    ['any other run', undefined, usual]
  ])('words the dialog for %s', async (_name, fromAnswer, text) => {
    serve(capacity({ running: [{ ...capacity().running[0], fromAnswer }] }))
    await shown()
    const running = within(screen.getByRole('region', { name: 'Running now' }))
    await act(async () => fireEvent.click(running.getByRole('button', { name: 'Stop' })))
    const dialog = within(screen.getByRole('dialog', { name: 'Stop this run?' }))
    expect(dialog.getByText(text)).toBeTruthy()
  })
})
