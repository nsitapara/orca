// @vitest-environment happy-dom
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { makeRepo, makeWorktree } from '@/components/activity/ActivityPrototypePage-test-fixtures'
import { TooltipProvider } from '@/components/ui/tooltip'
import { useAppStore } from '@/store'
import { getDefaultSettings } from '../../../../../shared/constants'
import { toSshExecutionHostId } from '../../../../../shared/execution-host'
import type { Worktree } from '../../../../../shared/worktree/types'
import { ARTIFACTS, PARENT_WT, ORDERS } from '../../shared/__fixtures__/artifacts'
import type { ArtifactsPayload } from '../../shared/api-types-artifacts'
import type * as LinearBranchIssue from '../activity-card/linear-branch-issue'
import { registerPilotStore } from '../store'
import { AgentArtifactsBody } from './AgentArtifactsBody'
import { ArtifactsFoldOut } from './ArtifactsFoldOut'
import { ArtifactsPageTabs } from './ArtifactsPageTabs'
import { resetArtifactsFeed } from './artifacts-feed'
import { artifactsView, resetArtifactsView, setArtifactsFoldOpen } from './artifacts-view'
import { WorktreeArtifactsChip } from './WorktreeArtifactsChip'

const rpc = vi.hoisted(() => {
  const reply: { payload: unknown } = { payload: null }
  return reply
})
vi.mock('../api', () => ({ pilotRpc: vi.fn(async () => rpc.payload) }))
const opened = vi.hoisted(() => vi.fn(() => true))
vi.mock('../activity-tabs/open-activity-worktree', () => ({ openActivityWorktree: opened }))
vi.mock('../activity-card/linear-branch-issue', async (importOriginal) => ({
  ...(await importOriginal<typeof LinearBranchIssue>()),
  useBranchLinearIssue: () => null,
  useLinearIssue: () => null
}))

const WORKTREE: Worktree = {
  ...makeWorktree(),
  path: PARENT_WT,
  branch: 'web-1982-improve-ordering-system',
  displayName: 'web-1982-improve-ordering-system'
}

function payload(over: Partial<ArtifactsPayload> = {}): ArtifactsPayload {
  return { fetchedAt: 1, artifacts: ARTIFACTS, error: null, refreshing: false, ...over }
}

async function show(ui: React.ReactNode) {
  const view = render(<TooltipProvider>{ui}</TooltipProvider>)
  await act(async () => {})
  return view
}

function page(signedIn: boolean) {
  return (
    <main>
      <ArtifactsPageTabs signedIn={signedIn} />
      <AgentArtifactsBody signedIn={signedIn}>
        <p>Orca shared list</p>
      </AgentArtifactsBody>
    </main>
  )
}

beforeEach(() => {
  rpc.payload = payload()
  useAppStore.setState({
    settings: getDefaultSettings('/tmp'),
    repos: [makeRepo()],
    worktreesByRepo: { 'repo-1': [WORKTREE] },
    activeWorktreeId: WORKTREE.id,
    activeView: 'terminal'
  })
  registerPilotStore(useAppStore)
})

afterEach(() => {
  cleanup()
  registerPilotStore(null)
  resetArtifactsFeed()
  resetArtifactsView()
  setArtifactsFoldOpen(true)
  window.localStorage.clear()
  opened.mockClear()
})

describe('the Artifacts page', () => {
  it("shows upstream's body, and no tabs, until Pilot attaches", async () => {
    registerPilotStore(null)
    await show(page(true))
    expect(screen.getByText('Orca shared list')).toBeTruthy()
    expect(screen.queryByRole('tablist')).toBeNull()
  })

  it('lists the agents’ artifacts without an Orca sign-in, and offers Orca’s list only when signed in', async () => {
    await show(page(false))
    const tabs = within(screen.getByRole('tablist'))
    expect(tabs.getAllByRole('tab').map((t) => t.textContent)).toEqual([
      'From agents2',
      'Local reports1',
      'Not tracked1'
    ])
    expect(screen.queryByText('Orca shared list')).toBeNull()
    expect(screen.getByText('Orders Rework')).toBeTruthy()
    expect(screen.getByText('Reading list')).toBeTruthy()
    expect(screen.getByText('2 sessions · 2 worktrees')).toBeTruthy()
  })

  it('switches tabs, searches, and shows Orca’s list on its own tab', async () => {
    await show(page(true))
    fireEvent.mouseDown(screen.getByRole('tab', { name: /Local reports/ }))
    fireEvent.click(screen.getByRole('tab', { name: /Local reports/ }))
    expect(artifactsView().tab).toBe('local')
    expect(screen.getByText('Token usage by job')).toBeTruthy()
    expect(screen.queryByText('Orders Rework')).toBeNull()
    fireEvent.change(screen.getByRole('textbox', { name: 'Search artifacts' }), {
      target: { value: 'nothing like it' }
    })
    expect(screen.getByText('No artifact matches these filters.')).toBeTruthy()
    fireEvent.mouseDown(screen.getByRole('tab', { name: 'Shared from Orca' }))
    fireEvent.click(screen.getByRole('tab', { name: 'Shared from Orca' }))
    expect(screen.getByText('Orca shared list')).toBeTruthy()
  })

  it('opens an artifact’s details: tickets, notes, files and who built it', async () => {
    await show(page(false))
    fireEvent.click(screen.getByText('Orders Rework'))
    const drawer = within(screen.getByRole('dialog'))
    expect(drawer.getByRole('button', { name: /Open artifact/ })).toBeTruthy()
    expect(drawer.getByText('WEB-1982')).toBeTruthy()
    expect(drawer.getByText('Orders rework prototype')).toBeTruthy()
    expect(drawer.getByText('Session scratchpad: gone once the session ends')).toBeTruthy()
    expect(drawer.getByText('Mockup keeper')).toBeTruthy()
    expect(drawer.getByText('Sub-issue worker')).toBeTruthy()
    expect(drawer.getAllByRole('button', { name: 'Copy resume command' })).toHaveLength(2)
  })

  it.each([
    ['a pilotcli without the index', payload({ artifacts: [], error: 'install a newer one' })],
    ['an answer it cannot read', { nope: true }]
  ])('says why it is empty for %s', async (_name, answer) => {
    rpc.payload = answer
    await show(page(false))
    expect(screen.getByText(/install a newer one|doesn't read/)).toBeTruthy()
    expect(screen.getByText('No artifact from an agent yet.')).toBeTruthy()
  })
})

describe('the artifacts chip', () => {
  it('shows the worktree’s count; a click selects it and opens the fold-out', async () => {
    window.localStorage.setItem('pilot.sidebar.artifacts-fold-closed', 'true')
    await show(<WorktreeArtifactsChip worktree={WORKTREE} />)
    const chip = screen.getByRole('button', { name: '1 artifact: show in the sidebar' })
    expect(chip.textContent).toBe('1')
    fireEvent.click(chip)
    expect(opened).toHaveBeenCalledWith(WORKTREE)
    expect(window.localStorage.getItem('pilot.sidebar.artifacts-fold-closed')).toBe('false')
  })

  it.each([
    ['without artifacts', { ...WORKTREE, path: '/elsewhere' }],
    ['on another machine', { ...WORKTREE, hostId: toSshExecutionHostId('devbox') }]
  ])('is absent %s', async (_name, worktree) => {
    await show(<WorktreeArtifactsChip worktree={worktree} />)
    expect(screen.queryByRole('button')).toBeNull()
  })
})

describe('the Artifacts fold-out', () => {
  it('lists the selected worktree’s artifacts and opens the page filtered to it', async () => {
    await show(<ArtifactsFoldOut />)
    const fold = within(screen.getByRole('region', { name: 'Artifacts' }))
    const header = fold.getByRole('button', { expanded: true })
    expect(header.textContent).toContain(WORKTREE.displayName)
    expect(header.textContent).toMatch(/1$/)
    expect(fold.getByText('Orders Rework')).toBeTruthy()
    expect(fold.getByText(/^WEB-1982 \+1 · .+ · v52$/)).toBeTruthy()
    fireEvent.click(fold.getByRole('button', { name: 'Show all in Artifacts →' }))
    expect(artifactsView()).toMatchObject({
      tab: 'agents',
      worktree: { path: PARENT_WT, label: WORKTREE.displayName }
    })
    expect(useAppStore.getState().activeView).toBe('artifacts')
  })

  it('folds, and remembers it', async () => {
    await show(<ArtifactsFoldOut />)
    fireEvent.click(screen.getByRole('button', { expanded: true }))
    expect(screen.queryByText('Orders Rework')).toBeNull()
    expect(window.localStorage.getItem('pilot.sidebar.artifacts-fold-closed')).toBe('true')
  })

  it('opens a row’s details on the page', async () => {
    await show(<ArtifactsFoldOut />)
    fireEvent.click(screen.getByText('Orders Rework'))
    expect(artifactsView()).toMatchObject({ tab: 'agents', selected: ORDERS.id })
  })

  it('says so when the worktree has none', async () => {
    useAppStore.setState({ worktreesByRepo: { 'repo-1': [{ ...WORKTREE, path: '/elsewhere' }] } })
    await show(<ArtifactsFoldOut />)
    expect(screen.getByText('No artifacts from this worktree yet.')).toBeTruthy()
  })
})
