// @vitest-environment happy-dom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { InboxItemRow, PilotStatus } from '../../../shared/api-types'
import { groupOf } from '../../../shared/inbox-groups'
import { byHost, LOCAL_NAMED, MINI } from '../../hosts/__fixtures__/hosts'
import { LOCAL_PILOT_HOST, type PilotHostEntry, type PilotHostRef } from '../../hosts/pilot-host'
import { resetPilotHostsFeed, setPilotHostsForTests } from '../../hosts/pilot-hosts-feed'
import { registerPilotStore, type PilotStore, type PilotStoreState } from '../../store'

const pilotRpc = vi.fn()
vi.mock('../../api', () => ({ pilotRpc: (...args: unknown[]) => pilotRpc(...args) }))
const activate = vi.fn()
vi.mock('@/lib/worktree-activation', () => ({
  activateAndRevealWorktree: (...args: unknown[]) => activate(...args)
}))

import { InboxPage } from './InboxPage'
import { repoNameForPath, worktreeIdForPath, WorktreeName } from './WorktreeLink'

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
// Mini's worktree named only by the execution-host alias.
const MINI_ALIAS: StoreWorktree = { id: 'c', path: '/w/x', hostId: 'runtime:mini' }
// Mini's worktree with this machine's id: worktree ids are per machine too.
const MINI_SAME_ID: StoreWorktree = { ...LOCAL_X, runtimeOwnerEnvironmentId: 'mini' }

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

  it.each<[string, PilotHostEntry[], StoreWorktree[], PilotHostRef | undefined, string | null]>([
    [
      "this machine skips another Pilot machine's worktree at the path",
      [LOCAL_NAMED, MINI],
      [MINI_X, LOCAL_X],
      undefined,
      'a'
    ],
    // The browser lists the page's own server's worktrees under its environment; that server is this machine.
    [
      'this machine keeps a worktree of an environment no other Pilot is on',
      [LOCAL_PILOT_HOST],
      [{ id: 's', path: '/w/x', runtimeOwnerEnvironmentId: 'server' }],
      undefined,
      's'
    ],
    [
      'Mini finds its worktree by the hostId alias',
      [LOCAL_NAMED, MINI],
      [LOCAL_X, MINI_ALIAS],
      MINI,
      'c'
    ],
    [
      "this machine skips Mini's worktree named by the hostId alias",
      [LOCAL_NAMED, MINI],
      [MINI_ALIAS],
      undefined,
      null
    ]
  ])('finds the worktree at the path on its machine: %s', (_case, hosts, worktrees, host, id) => {
    setPilotHostsForTests(hosts)
    registerPilotStore(storeWith(worktrees))
    expect(worktreeIdForPath('/w/x', host)).toBe(id)
  })

  it("shows this machine's worktree name as plain text once the worktree's environment turns out to be another Pilot", async () => {
    registerPilotStore(storeWith([MINI_X]))
    render(
      <WorktreeName
        group={groupOf({ itemKey: null, worktreePath: '/w/x', automationId: 'a' }, [])}
      />
    )
    await act(async () => {})
    expect(screen.queryByRole('button')).toBeTruthy()
    act(() => setPilotHostsForTests([LOCAL_NAMED, MINI]))
    expect(screen.queryByRole('button')).toBeNull()
  })

  const onMini = { executionHostId: 'runtime:mini' }
  it.each<[string, StoreWorktree[], unknown[][]]>([
    [
      "opens that machine's worktree on its execution host, even when this machine has the same id",
      [LOCAL_X, MINI_SAME_ID],
      [
        ['a', onMini],
        ['a', onMini]
      ]
    ],
    ['stays plain text when only this machine has the path', [LOCAL_X], []]
  ])(
    "a remote section's worktree name %s, never this machine's",
    async (_case, worktrees, opened) => {
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
      // One at a time: each click loads the activation module before it opens.
      for (const [at, button] of openers.entries()) {
        fireEvent.click(button)
        await waitFor(() => expect(activate).toHaveBeenCalledTimes(at + 1))
      }
      expect(activate.mock.calls).toEqual(opened)
      expect(openers).toHaveLength(opened.length)
    }
  )
})
