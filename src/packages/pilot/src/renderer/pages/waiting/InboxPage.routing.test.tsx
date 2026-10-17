// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { InboxListRow } from '../../../shared/api-types'
import type { DispatchReport, InboxListPayload, QueueEntry } from '../../../shared/inbox-types'
import { APPROVE_ON_DESKTOP } from '../../../shared/pilot-replies'
import { testRun } from '../../../shared/run-views/__fixtures__/runs'
import type { DoneRun } from '../../../shared/visibility-types'

const pilotRpc = vi.fn()
vi.mock('../../api', () => ({ pilotRpc: (...args: unknown[]) => pilotRpc(...args) }))

import { byHost, LOCAL_NAMED, MINI, MINI_OFFLINE } from '../../hosts/__fixtures__/hosts'
import { inboxRow } from '../../hosts/__fixtures__/inbox-row'
import type { PilotHostEntry } from '../../hosts/pilot-host'
import { resetPilotHostsFeed, setPilotHostsForTests } from '../../hosts/pilot-hosts-feed'
import { resetAutomationsFeed } from '../../run-views/automations-feed'
import { setPilotAutomationsView, showInboxCard } from '../automations-view'
import { InboxPage } from './InboxPage'

const question = (worktreePath: string, title: string): InboxListRow =>
  inboxRow({
    worktreePath,
    title,
    options: [
      { label: 'Yes', meaning: '' },
      { label: 'No', meaning: '' }
    ]
  })
const PUSH = inboxRow({
  id: 'in_push',
  type: 'action',
  title: 'Push the fix?',
  action: 'push',
  actionArgs: { argv: ['a'] },
  options: [
    { label: 'Approve', meaning: 'push it' },
    { label: 'Skip', meaning: 'keep it local' }
  ]
})
const listOf = (items: InboxListRow[]): InboxListPayload => ({
  items,
  people: [{ id: 'nish', name: 'Nish' }],
  groups: [],
  automations: [{ id: 'tests', name: 'Tests' }],
  answerStates: {},
  runLines: {}
})
const doneRun = (id: string, itemLabel: string): DoneRun => ({
  run: { ...testRun({ id, itemLabel, status: 'done' }), fields: {} },
  effects: [],
  defaults: []
})
const HELD: QueueEntry = {
  rowId: 1,
  itemId: 'in_x',
  title: 'Mark !1588 ready?',
  type: 'action',
  automationId: 'tests',
  automationName: 'Tests',
  worktreePath: null,
  person: 'nish',
  answer: 'approve',
  state: 'held',
  holdReason: 'typing',
  holdDetail: 'someone is typing',
  readyAt: 0,
  how: 'script',
  fires: 'Run mark_ready; no agent',
  updatedAt: 0
}
const report = (over: Partial<DispatchReport>): DispatchReport => ({
  retired: 0,
  ticked: 0,
  actions: 0,
  agents: 0,
  held: 0,
  reasked: 0,
  ...over
})

type Machine = {
  items?: InboxListRow[]
  done?: DoneRun[]
  queue?: QueueEntry[]
  // Methods that throw on this machine, with the error each throws.
  fails?: Partial<Record<string, string>>
  applied?: DispatchReport
}
const machine =
  ({ items = [], done = [], queue = [], fails = {}, applied = report({}) }: Machine) =>
  (method: string) => {
    const error = fails[method]
    if (error) {
      throw new Error(error)
    }
    if (method === 'pilot.inbox.list') {
      return listOf(items)
    }
    if (method === 'pilot.queue.list') {
      return { entries: queue }
    }
    if (method === 'pilot.answers.applyNow') {
      return applied
    }
    if (method === 'pilot.runs.acknowledge') {
      return { acknowledged: [], kept: [], notKept: [] }
    }
    return method === 'pilot.runs.doneForYou' ? done : { status: 'answered' }
  }
const cardTitled = async (title: string) =>
  (await screen.findByRole('heading', { name: title })).closest('article')!
const choice = (from: ParentNode, value: string): Element =>
  from.querySelector(`[data-choice="${value}"]`)!
const callsOf = (method: string) => pilotRpc.mock.calls.filter(([m]) => m === method)

describe('InboxPage card actions on more than one machine', () => {
  afterEach(() => {
    cleanup()
    resetAutomationsFeed()
    resetPilotHostsFeed()
    pilotRpc.mockReset()
  })

  it('answers a card from another machine on that machine, after grouping and the section filter (Review Focus 3)', async () => {
    setPilotHostsForTests([LOCAL_NAMED, MINI])
    // The same card id on both machines: a lost host tag answers this machine's card instead.
    pilotRpc.mockImplementation(
      byHost({
        local: machine({ items: [question('/wt/web-1', 'Local question')] }),
        mini: machine({ items: [question('/wt/web-2', 'Mini question')] })
      })
    )
    render(<InboxPage />)
    await cardTitled('Mini question')
    fireEvent.click(screen.getByRole('button', { name: /^web-2 ?· 1$/ }))
    expect(screen.queryByRole('heading', { name: 'Local question' })).toBeNull()
    fireEvent.click(choice(await cardTitled('Mini question'), 'No'))
    await waitFor(() =>
      expect(pilotRpc).toHaveBeenCalledWith(
        'pilot.inbox.answer',
        expect.objectContaining({ id: 'in_1' }),
        { target: MINI.target }
      )
    )
    expect(pilotRpc.mock.calls.filter(([m, , o]) => m === 'pilot.inbox.answer' && !o)).toHaveLength(
      0
    )
  })

  it("shows the owning machine's refusal on the card", async () => {
    setPilotHostsForTests([LOCAL_NAMED, MINI])
    pilotRpc.mockImplementation(
      byHost({
        local: machine({}),
        mini: machine({ items: [PUSH], fails: { 'pilot.inbox.answer': APPROVE_ON_DESKTOP } })
      })
    )
    render(<InboxPage />)
    fireEvent.click(choice(await cardTitled('Push the fix?'), 'Approve'))
    expect(
      await within(await cardTitled('Push the fix?')).findByText(APPROVE_ON_DESKTOP)
    ).toBeTruthy()
  })

  it("acknowledges a Got it on another machine's run there, never this machine's run with the same id", async () => {
    setPilotHostsForTests([LOCAL_NAMED, MINI])
    pilotRpc.mockImplementation(
      byHost({
        local: machine({ done: [doneRun('r1', 'WEB-1')] }),
        mini: machine({ done: [doneRun('r1', 'WEB-2')] })
      })
    )
    render(<InboxPage />)
    fireEvent.click(await screen.findByRole('button', { name: 'Got it: WEB-2' }))
    await waitFor(() => expect(callsOf('pilot.runs.acknowledge')).toHaveLength(1))
    expect(callsOf('pilot.runs.acknowledge')).toEqual([
      ['pilot.runs.acknowledge', { runIds: ['r1'] }, { target: MINI.target }]
    ])
  })

  it("acknowledges each machine's runs on that machine", async () => {
    setPilotHostsForTests([LOCAL_NAMED, MINI])
    pilotRpc.mockImplementation(
      byHost({
        local: machine({ done: [doneRun('r1', 'WEB-1'), doneRun('r2', 'WEB-3')] }),
        mini: machine({ done: [doneRun('r1', 'WEB-2')] })
      })
    )
    render(<InboxPage />)
    await screen.findByRole('button', { name: 'Got it: WEB-2' })
    fireEvent.click(screen.getByRole('button', { name: 'Got all' }))
    await waitFor(() => expect(callsOf('pilot.runs.acknowledge')).toHaveLength(2))
    expect(callsOf('pilot.runs.acknowledge')).toEqual([
      ['pilot.runs.acknowledge', { runIds: ['r1', 'r2'] }],
      ['pilot.runs.acknowledge', { runIds: ['r1'] }, { target: MINI.target }]
    ])
  })

  it("applies every machine's answers and says what each couldn't", async () => {
    const studio: PilotHostEntry = {
      ...MINI,
      key: 'env:studio',
      target: { kind: 'environment', environmentId: 'studio' },
      machineName: 'Studio',
      schedulerOn: null
    }
    const schedulerOff: PilotHostEntry = {
      ...MINI,
      key: 'env:linux',
      target: { kind: 'environment', environmentId: 'linux' },
      machineName: 'Linux box',
      schedulerOn: false
    }
    const away: PilotHostEntry = {
      ...MINI_OFFLINE,
      key: 'env:away',
      target: { kind: 'environment', environmentId: 'away' },
      machineName: 'Away'
    }
    setPilotHostsForTests([LOCAL_NAMED, MINI, studio, schedulerOff, away])
    pilotRpc.mockImplementation(
      byHost({
        local: machine({ queue: [HELD], applied: report({ ticked: 1, held: 1 }) }),
        mini: machine({ fails: { 'pilot.answers.applyNow': 'Pilot is busy' } }),
        studio: machine({ applied: report({ actions: 1 }) }),
        // Neither is asked: one runs no scheduler, the other can't be reached.
        linux: machine({ applied: report({ retired: 5 }) }),
        away: machine({ applied: report({ agents: 7 }) })
      })
    )
    render(<InboxPage />)
    fireEvent.click(await screen.findByRole('button', { name: 'Apply now' }))
    expect(
      await screen.findByText(
        "1 closed · 1 ran an action · 1 still held · Mac mini couldn't apply: Pilot is busy"
      )
    ).toBeTruthy()
    expect(callsOf('pilot.answers.applyNow').map(([, , o]) => o?.target ?? null)).toEqual([
      null,
      MINI.target,
      studio.target
    ])
  })

  it("picks the card the run panel named on its machine once that machine answers, not this machine's same-id card", async () => {
    setPilotHostsForTests([LOCAL_NAMED, MINI])
    let answerMini: (list: InboxListPayload) => void = () => {}
    const mini = machine({})
    pilotRpc.mockImplementation(
      byHost({
        local: machine({ items: [question('/wt/web-1', 'Local question')] }),
        mini: (method) =>
          method === 'pilot.inbox.list'
            ? new Promise<InboxListPayload>((resolve) => (answerMini = resolve))
            : mini(method)
      })
    )
    showInboxCard('in_1', MINI)
    render(<InboxPage />)
    await cardTitled('Local question')
    answerMini(listOf([question('/wt/web-2', 'Mini question')]))
    await cardTitled('Mini question')
    await waitFor(() =>
      expect(document.getElementById('card-env:mini/in_1')?.hasAttribute('data-selected')).toBe(
        true
      )
    )
    expect(document.getElementById('card-in_1')?.hasAttribute('data-selected')).toBe(false)
    setPilotAutomationsView('automations')
  })
})
