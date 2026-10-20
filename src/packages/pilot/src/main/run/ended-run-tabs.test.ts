import { describe, expect, it } from 'vitest'
import type { RunStatus } from '../../shared/api-types'
import { PilotStore } from '../store/store'
import type { SessionTerminalState } from './agent-step'
import { createEndedRunTabs, endedRunTerminals, type TurnRow } from './ended-run-tabs'
import { worktreeBusy } from '../fields/worktree-busy'
import { SessionClaims } from './session-claims'

type StepOpts = { status?: RunStatus; sessionId?: string | null; idx?: number; startedAt?: number }

function harness() {
  const store = PilotStore.open(':memory:')
  // Each connected terminal's handle and the pane it sits in.
  const open = new Map<string, string>()
  const rows = new Map<string, TurnRow[]>()
  const states = new Map<string, SessionTerminalState>()
  const looked: string[] = []
  // The turn start each look judged a draft by.
  const turnStarts: (number | undefined)[] = []
  const closed: string[] = []
  const rowsOfPane = (paneKey: string): TurnRow[] => rows.get(paneKey) ?? []
  const claims = new SessionClaims(() => 0)
  const listing = { cutShort: false }
  const tabs = createEndedRunTabs({
    store,
    openTerminals: async () =>
      listing.cutShort ? null : [...open].map(([handle, pane]) => ({ handle, paneKeys: [pane] })),
    rowsOf: rowsOfPane,
    terminals: {
      state: async (t, sessionId, opts) => {
        looked.push(`${t.handle}:${claims.holder(sessionId)?.by ?? 'unclaimed'}`)
        turnStarts.push(opts?.turnStartedAt)
        return states.get(t.handle) ?? 'free'
      },
      close: async (handle) => {
        closed.push(handle)
        open.delete(handle)
      },
      claims
    },
    log: () => {}
  })
  // An agent step on `handle` that ran from startedAt to startedAt + 9, in a run with `status` (done by default).
  const step = (runId: string, handle: string, o: StepOpts = {}) => {
    const idx = o.idx ?? 0
    const startedAt = o.startedAt ?? 2
    if (!store.runs.get(runId)) {
      store.runs.create({
        id: runId,
        automationId: 'job',
        tickId: null,
        itemKey: runId,
        itemLabel: runId,
        worktreePath: '/wt',
        startedAt: 1
      })
    }
    const sessionId = o.sessionId === undefined ? 's1' : o.sessionId
    store.runs.createStep({
      runId,
      idx,
      name: 'agent',
      agent: 'claude',
      skill: null,
      startedAt,
      sessionId
    })
    store.runs.updateStep(runId, idx, {
      status: 'done',
      terminalHandle: handle,
      paneKey: `${handle}:pane`,
      finishedAt: startedAt + 9
    })
    store.runs.update(runId, { status: o.status ?? 'done', finishedAt: startedAt + 10 })
    open.set(handle, `${handle}:pane`)
  }
  return {
    store,
    open,
    rows,
    rowsOfPane,
    states,
    looked,
    turnStarts,
    closed,
    claims,
    listing,
    tabs,
    step
  }
}

describe('closing ended runs’ tabs', () => {
  it.each([
    ['a done run', 'done'],
    ['a run that left cards (needs you)', 'needs_you'],
    ['a failed run', 'failed'],
    ['a timed-out run', 'timed_out'],
    ['a cancelled run', 'cancelled']
  ] as const)('%s: its idle tab closes', async (_name, status) => {
    const h = harness()
    h.step('r1', 'h1', { status })
    await h.tabs.pass()
    expect(h.closed).toEqual(['h1'])
  })

  type Case = [string, (h: ReturnType<typeof harness>) => void]
  it.each<Case>([
    [
      'its run is still going (a later step may use it)',
      (h) => h.step('r1', 'h1', { status: 'running' })
    ],
    ['its step has no session to resume', (h) => h.step('r1', 'h1', { sessionId: null })],
    [
      'a turn began after its last step ended (taken over)',
      (h) => {
        h.step('r1', 'h1')
        h.rows.set('h1:pane', [
          { state: 'done', turnStartedAt: 2, stateStartedAt: 5 },
          { state: 'working', stateStartedAt: 30 }
        ])
      }
    ],
    [
      'someone is typing in it, or its agent is busy',
      (h) => {
        h.step('r1', 'h1')
        h.states.set('h1', 'busy')
      }
    ],
    [
      'it runs another session now',
      (h) => {
        h.step('r1', 'h1')
        h.states.set('h1', 'other')
      }
    ],
    [
      'a start on its session is in flight',
      (h) => {
        h.step('r1', 'h1')
        h.claims.acquire('s1', 'launch:r2:0')
      }
    ],
    [
      'it is closed already',
      (h) => {
        h.step('r1', 'h1')
        h.open.delete('h1')
      }
    ],
    [
      'the terminal listing was cut short',
      (h) => {
        h.step('r1', 'h1')
        h.listing.cutShort = true
      }
    ]
  ])('a tab stays when %s', async (_name, arrange) => {
    const h = harness()
    arrange(h)
    h.open.set('not-pilots', 'not-pilots:pane')
    await h.tabs.pass()
    expect(h.closed).toEqual([])
  })

  // The last turn's start lets the look tell the agent's leftover suggestion from someone's typing.
  it('closes under the session’s claim, judging drafts by its last turn, and lets it go after', async () => {
    const h = harness()
    h.step('r1', 'h1')
    h.rows.set('h1:pane', [
      { state: 'done', turnStartedAt: 1, stateStartedAt: 2 },
      { state: 'done', turnStartedAt: 3, stateStartedAt: 10 }
    ])
    await h.tabs.pass()
    expect(h.looked).toEqual(['h1:close-ended:h1'])
    expect(h.turnStarts).toEqual([3])
    expect(h.closed).toEqual(['h1'])
    expect(h.claims.holder('s1')).toBeNull()
  })

  it('looks at a busy tab again next pass, but never again at one left for good', async () => {
    const h = harness()
    h.step('r1', 'busy-tab')
    h.step('r2', 'other-tab', { sessionId: 's2' })
    h.states.set('busy-tab', 'busy')
    h.states.set('other-tab', 'other')
    await h.tabs.pass()
    h.states.delete('busy-tab')
    h.states.delete('other-tab')
    await h.tabs.pass()
    expect(h.looked.map((l) => l.split(':')[0])).toEqual(['busy-tab', 'other-tab', 'busy-tab'])
    expect(h.closed).toEqual(['busy-tab'])
  })

  it('finds a tab by its pane when a restart gave its terminal a new handle', async () => {
    const h = harness()
    h.step('r1', 'before-restart')
    h.open.delete('before-restart')
    h.open.set('after-restart', 'before-restart:pane')
    // The session resumed in its pane after the restart: a boundary, not a turn.
    h.rows.set('before-restart:pane', [
      { state: 'done', stateStartedAt: 50, sessionBoundary: true }
    ])
    await h.tabs.pass()
    expect(h.closed).toEqual(['after-restart'])
  })

  // r2 is an answer run that typed its answers into the asking run's tab: the tab closes once both runs ended, judged by
  // the answer step's end.
  it('a tab two runs used closes once both ended', async () => {
    const h = harness()
    h.step('r1', 'h1', { status: 'needs_you' })
    h.step('r2', 'h1', { status: 'running', startedAt: 30 })
    h.rows.set('h1:pane', [{ state: 'done', turnStartedAt: 30, stateStartedAt: 35 }])
    await h.tabs.pass()
    expect(h.closed).toEqual([])
    h.store.runs.update('r2', { status: 'done' })
    await h.tabs.pass()
    expect(h.closed).toEqual(['h1'])
  })
})

describe('endedRunTerminals', () => {
  const tab = (handle: string, paneKey = 'x:y') => {
    const [tabId = '', leafId = ''] = paneKey.split(':')
    return {
      handle,
      title: null,
      connected: true,
      agentIdentity: 'claude',
      worktreePath: '/wt',
      tabId,
      leafId
    }
  }

  it('a tab whose recorded run is still running isn’t ended', () => {
    const h = harness()
    h.step('r1', 'h1', { status: 'running' })
    expect(endedRunTerminals(h.store, [tab('h1')], h.rowsOfPane)(tab('h1'))).toBe(false)
  })

  it('a tab whose runs all ended is, by handle or by pane; an unrecorded one isn’t', () => {
    const h = harness()
    h.step('r1', 'h1')
    const ended = endedRunTerminals(
      h.store,
      [tab('h1'), tab('h2', 'h1:pane'), tab('person')],
      h.rowsOfPane
    )
    expect([ended(tab('h1')), ended(tab('h2', 'h1:pane')), ended(tab('person'))]).toEqual([
      true,
      true,
      false
    ])
  })

  it('a tab with a turn begun after its last step ended was taken over, so it isn’t ended', () => {
    const h = harness()
    h.step('r1', 'h1')
    h.rows.set('h1:pane', [{ state: 'working', turnStartedAt: 30, stateStartedAt: 30 }])
    expect(endedRunTerminals(h.store, [tab('h1')], h.rowsOfPane)(tab('h1'))).toBe(false)
  })

  it('finds a tab by its recorded pane key too', () => {
    const h = harness()
    h.step('r1', 'h1')
    const orphan = { ...tab('h9', 'a:b'), recordedPaneKey: 'h1:pane' }
    expect(endedRunTerminals(h.store, [orphan], h.rowsOfPane)(orphan)).toBe(true)
  })

  it.each([
    ['a turn begun after the step ended: its draft is typing', true, true],
    ['no later turn: the leftover draft isn’t busy', false, false]
  ])('a finished run’s tab, %s', async (_name, tookOver, typing) => {
    const h = harness()
    h.step('r1', 'h1')
    if (tookOver) {
      h.rows.set('h1:pane', [{ state: 'working', turnStartedAt: 30, stateStartedAt: 30 }])
    }
    const t = tab('h1', 'h1:pane')
    const reads = {
      draft: async () => 'half a thought',
      agentStates: async () => new Map<string, string>(),
      tabBusy: async () => false
    }
    const ended = endedRunTerminals(h.store, [t], h.rowsOfPane)
    const busy = await worktreeBusy('/wt', [t], reads, ended)
    expect(busy?.typing ?? false).toBe(typing)
  })
})
