// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { InboxItemRow, PilotStatus } from '../../../shared/api-types'
import { byHost, LOCAL_NAMED, MINI } from '../../hosts/__fixtures__/hosts'
import { LOCAL_PILOT_HOST, type PilotHostEntry } from '../../hosts/pilot-host'
import { resetPilotHostsFeed, setPilotHostsForTests } from '../../hosts/pilot-hosts-feed'
import { registerPilotStore, type PilotStore, type PilotStoreState } from '../../store'

const pilotRpc = vi.fn()
vi.mock('../../api', () => ({ pilotRpc: (...args: unknown[]) => pilotRpc(...args) }))
const activate = vi.fn()
vi.mock('@/lib/worktree-activation', () => ({
  activateAndRevealWorktree: (...args: unknown[]) => activate(...args)
}))

import { InboxPage } from './InboxPage'
import { repoNameForPath, worktreeIdForPath } from './WorktreeLink'

function card(over: Partial<InboxItemRow>): InboxItemRow {
  return {
    id: 'c',
    automationId: 'a',
    runId: 'r',
    stepIdx: 0,
    itemKey: null,
    worktreePath: null,
    person: 'nish',
    type: 'bug',
    title: 't',
    context: '',
    options: [],
    suggested: null,
    detailsMd: null,
    details: null,
    action: null,
    actionArgs: null,
    parts: {},
    switchWords: [],
    digest: 'd',
    version: 1,
    status: 'open',
    answer: null,
    answeredAt: null,
    answeredBy: null,
    replies: [],
    outcome: null,
    createdAt: 1,
    updatedAt: 1,
    source: 'engine',
    vaultRef: null,
    ...over
  }
}
const ITEMS = [
  card({ id: 'by-path', title: 'By path', worktreePath: '/w/web-1' }),
  card({ id: 'by-key', title: 'By key', itemKey: 'wt:repo-9::/w/web-2' }),
  card({ id: 'gone', title: 'Gone', worktreePath: '/w/web-gone' }),
  card({ id: 'mr', title: 'An MR', itemKey: 'mr:1579' }),
  card({ id: 'job', title: 'A job card' })
]

function serve() {
  pilotRpc.mockImplementation(async (method: string) => {
    if (method === 'pilot.inbox.list') {
      return {
        items: ITEMS,
        people: [{ id: 'n', name: 'N' }],
        groups: [],
        automations: [{ id: 'a', name: 'Job A' }],
        runLines: {},
        answerStates: {}
      }
    }
    return method === 'pilot.queue.list' ? { entries: [] } : { imported: 0, skipped: [] }
  })
}
const heading = (label: string) => screen.getByRole('region', { name: label }).querySelector('h2')!

describe('opening a worktree from its section', () => {
  beforeEach(() => {
    registerPilotStore({
      getState: () =>
        ({
          rightSidebarOpen: false,
          setRightSidebarOpen: () => {},
          worktreesByRepo: {
            'repo-1': [{ id: 'repo-1::/w/web-1', path: '/w/web-1' }],
            'repo-9': [{ id: 'repo-9::/w/web-2', path: '/w/web-2' }]
          },
          repos: [{ id: 'repo-1', displayName: 'web-platform' }]
        }) as never
    })
  })
  afterEach(() => {
    cleanup()
    pilotRpc.mockReset()
    activate.mockReset()
    registerPilotStore(null)
  })

  it('makes the worktree name a button that activates the worktree found by path', async () => {
    serve()
    render(<InboxPage />)
    await screen.findByRole('heading', { name: 'By path' })
    const open = within(heading('web-1')).getByRole('button', { name: /web-1/ })
    expect(open.getAttribute('title')).toBe('Open this worktree')
    fireEvent.click(open)
    await waitFor(() => expect(activate).toHaveBeenCalledWith('repo-1::/w/web-1'))
  })

  it('takes the id from a wt:<repoId>::<path> item key when the store knows it', async () => {
    serve()
    render(<InboxPage />)
    await screen.findByRole('heading', { name: 'By key' })
    fireEvent.click(within(heading('web-2')).getByRole('button', { name: /web-2/ }))
    await waitFor(() => expect(activate).toHaveBeenCalledWith('repo-9::/w/web-2'))
  })

  it.each([
    ['a listed worktree', '/w/web-1/', 'web-platform'],
    ['a worktree whose project the app does not list', '/w/web-2', null],
    ['a worktree the app does not have', '/w/gone', null]
  ])('names the project of %s', (_case, path, project) => {
    expect(repoNameForPath(path)).toBe(project)
  })

  it('renders plain text for a worktree the app does not have open', async () => {
    serve()
    render(<InboxPage />)
    await screen.findByRole('heading', { name: 'Gone' })
    const h = heading('web-gone')
    expect(within(h).queryByRole('button')).toBeNull()
    expect(within(h).getByText('web-gone').getAttribute('title')).toBe('Not open in Pilot')
  })

  it('has no button on MR or job sections', async () => {
    serve()
    render(<InboxPage />)
    await screen.findByRole('heading', { name: 'An MR' })
    expect(within(heading('!1579')).queryByRole('button')).toBeNull()
    expect(within(heading('Job A')).queryByRole('button')).toBeNull()
  })

  it('adds an open button beside each known worktree in the list, which still filters by its heading', async () => {
    serve()
    render(<InboxPage />)
    await screen.findByRole('heading', { name: 'By path' })
    const nav = within(screen.getByRole('navigation', { name: 'Cards' }))
    fireEvent.click(nav.getByRole('button', { name: 'Open web-1 in Pilot' }))
    await waitFor(() => expect(activate).toHaveBeenCalledWith('repo-1::/w/web-1'))
    expect(screen.getAllByRole('region')).toHaveLength(5)
    fireEvent.click(nav.getByRole('button', { name: 'web-1 · 1' }))
    expect(screen.getAllByRole('region')).toHaveLength(1)
    expect(nav.queryByRole('button', { name: 'Open web-gone in Pilot' })).toBeNull()
    expect(nav.queryByRole('button', { name: /Open !1579/ })).toBeNull()
  })
})

type StoreWorktree = NonNullable<PilotStoreState['worktreesByRepo']>[string][number]

const LOCAL_X: StoreWorktree = { id: 'a', path: '/w/x' }
const MINI_X: StoreWorktree = { id: 'b', path: '/w/x', runtimeOwnerEnvironmentId: 'mini' }

// Paired with Mini, as the store shows it: the hosts feed finds Mini through its runtime environment.
function storeWith(worktrees: StoreWorktree[], paired = false): PilotStore {
  const state: PilotStoreState = {
    rightSidebarOpen: false,
    setRightSidebarOpen: () => {},
    worktreesByRepo: { 'repo-1': worktrees },
    ...(paired ? { runtimeEnvironments: [{ id: 'mini', name: 'mini' }] } : {})
  }
  return { getState: () => state }
}

function engine(host: PilotHostEntry): PilotStatus {
  return {
    version: '1',
    process: 'main',
    dataPath: host.dataPath ?? '',
    machineName: host.machineName,
    schedulerOn: true,
    automationDirs: [],
    missingDirs: [],
    peopleError: null,
    error: null,
    loopStartedAt: null,
    lastLoopFinishedAt: null,
    orcaAutomationsOff: true
  }
}

const machineWith =
  (host: PilotHostEntry, items: InboxItemRow[]) =>
  (method: string): unknown => {
    if (method === 'pilot.status') {
      return engine(host)
    }
    if (method === 'pilot.inbox.list') {
      return {
        items,
        people: [{ id: 'n', name: 'N' }],
        groups: [],
        automations: [{ id: 'a', name: 'Job A' }],
        runLines: {},
        answerStates: {}
      }
    }
    return method === 'pilot.queue.list' ? { entries: [] } : []
  }

describe('opening a worktree on another machine', () => {
  afterEach(() => {
    cleanup()
    pilotRpc.mockReset()
    activate.mockReset()
    registerPilotStore(null)
    resetPilotHostsFeed()
  })

  it("finds a remote card's worktree among that machine's worktrees, never a local one at the same path (Review Focus 2)", () => {
    registerPilotStore(storeWith([LOCAL_X, MINI_X]))
    expect(worktreeIdForPath('/w/x', MINI)).toBe('b')
    expect(worktreeIdForPath('/w/x')).toBe('a')
    registerPilotStore(storeWith([LOCAL_X]))
    expect(worktreeIdForPath('/w/x', MINI)).toBeNull()
  })

  it.each([
    [
      "skips another Pilot machine's worktree at the path",
      [LOCAL_NAMED, MINI],
      [MINI_X, LOCAL_X],
      'a'
    ],
    // The browser lists the page's own server's worktrees under its environment; that server is this machine.
    [
      'keeps a worktree of an environment no other Pilot is on',
      [LOCAL_PILOT_HOST],
      [{ id: 's', path: '/w/x', runtimeOwnerEnvironmentId: 'server' }],
      's'
    ]
  ])("finds this machine's worktree by path: %s", (_case, hosts, worktrees, id) => {
    setPilotHostsForTests(hosts)
    registerPilotStore(storeWith(worktrees))
    expect(worktreeIdForPath('/w/x')).toBe(id)
  })

  it.each<[string, StoreWorktree[], string | null]>([
    ["opens that machine's worktree", [LOCAL_X, MINI_X], 'b'],
    ['stays plain text when only this machine has the path', [LOCAL_X], null]
  ])("a remote section's worktree name %s, never this machine's", async (_case, worktrees, id) => {
    registerPilotStore(storeWith(worktrees, true))
    pilotRpc.mockImplementation(
      byHost({
        local: machineWith(LOCAL_NAMED, []),
        mini: machineWith(MINI, [card({ id: 'm', title: 'Mini card', worktreePath: '/w/x' })])
      })
    )
    render(<InboxPage />)
    await screen.findByRole('heading', { name: 'Mini card' })
    const nav = within(screen.getByRole('navigation', { name: 'Cards' }))
    // The heading's name and the list's open button: both, or neither.
    const openers = [
      ...within(heading('x')).queryAllByRole('button'),
      ...nav.queryAllByRole('button', { name: 'Open x in Pilot' })
    ]
    const opened = id ? [[id], [id]] : []
    // One at a time: each click loads the activation module before it opens.
    for (const [at, button] of openers.entries()) {
      fireEvent.click(button)
      await waitFor(() => expect(activate).toHaveBeenCalledTimes(at + 1))
    }
    expect(activate.mock.calls).toEqual(opened)
    expect(openers).toHaveLength(opened.length)
  })
})
