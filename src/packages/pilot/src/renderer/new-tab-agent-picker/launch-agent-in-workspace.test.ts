import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { toast } from 'sonner'
import type { LaunchAgentInNewTabArgs } from '@/lib/launch-agent-in-new-tab'
import {
  isWebRuntimeInitialTerminalBootstrapInFlight,
  resetWebRuntimeInitialTerminalBootstrapForTests
} from '@/runtime/web-runtime-initial-terminal-bootstrap'
import { useAppStore } from '@/store'
import { makeTab } from '@/store/slices/store-session-test-harness'
import type { Worktree } from '../../../../../shared/worktree/types'
import { launchAgentInWorkspace, type WorkspaceLaunchSwitch } from './launch-agent-in-workspace'
import { machineWorktree } from './new-tab-machine-test-fixtures'

const launches = vi.hoisted((): LaunchAgentInNewTabArgs[] => [])
vi.mock('@/lib/launch-agent-in-new-tab', () => ({
  launchAgentInNewTab: (args: LaunchAgentInNewTabArgs) => {
    launches.push(args)
    if (args.beforeSurfaceOpen?.({ kind: 'host-published' }) === false) {
      return null
    }
    return { surface: { kind: 'host-published' } }
  }
}))
vi.mock('sonner', () => ({ toast: { error: vi.fn() } }))

const initial = useAppStore.getState()
const remoteFeat = machineWorktree('repo-b', '/b/feat', {
  hostId: 'runtime:env-b',
  runtimeOwnerEnvironmentId: 'env-b'
})
// Why: a local workspace seeds its own shell on activation, so it is the row that catches an extra one.
const localFeat = machineWorktree('repo-a', '/a/feat')

describe('launchAgentInWorkspace', () => {
  beforeEach(() => {
    useAppStore.setState({
      setActiveWorktree: vi.fn(),
      revealWorktreeInSidebar: vi.fn(),
      createTab: vi.fn(),
      setActiveRepo: vi.fn(),
      setActiveView: vi.fn(),
      markWorktreeVisited: vi.fn(),
      recordWorktreeVisit: vi.fn()
    })
  })

  afterEach(() => {
    useAppStore.setState(initial, true)
    launches.length = 0
    vi.mocked(toast.error).mockClear()
    resetWebRuntimeInitialTerminalBootstrapForTests()
    vi.useRealTimers()
  })

  const toSecondMac: WorkspaceLaunchSwitch = {
    executionHostId: 'runtime:env-b',
    machineLabel: 'Second Mac'
  }
  const firstShellHeld = (): boolean =>
    isWebRuntimeInitialTerminalBootstrapInFlight('env-b', remoteFeat.id)

  // Why: the host's first answer for a never-opened workspace is empty, which seeds a shell beside the agent.
  it("holds the other machine's first shell from the switch until the agent's tab lands", () => {
    let heldAtSwitch = false
    useAppStore.setState({
      worktreesByRepo: { [remoteFeat.repoId]: [remoteFeat] },
      setActiveWorktree: vi.fn(() => {
        heldAtSwitch = firstShellHeld()
        return true
      })
    })
    launchAgentInWorkspace({ worktreeId: remoteFeat.id, agent: 'codex', switchTo: toSecondMac })
    expect(heldAtSwitch).toBe(true)
    useAppStore.setState({
      tabsByWorktree: { [remoteFeat.id]: [makeTab({ id: 'agent', worktreeId: remoteFeat.id })] }
    })
    expect(firstShellHeld()).toBe(false)
  })

  it("lets the first shell through when the agent's tab never lands", () => {
    vi.useFakeTimers()
    useAppStore.setState({ worktreesByRepo: { [remoteFeat.repoId]: [remoteFeat] } })
    launchAgentInWorkspace({ worktreeId: remoteFeat.id, agent: 'codex', switchTo: toSecondMac })
    vi.advanceTimersByTime(30_000)
    expect(firstShellHeld()).toBe(false)
  })

  it('opens in the current workspace without switching', () => {
    useAppStore.setState({ activeGroupIdByWorktree: { 'wt-1': 'g' } })
    launchAgentInWorkspace({ worktreeId: 'wt-1', agent: 'codex' })
    expect(launches).toEqual([
      expect.objectContaining({
        agent: 'codex',
        worktreeId: 'wt-1',
        groupId: 'g',
        launchSource: 'shortcut',
        beforeSurfaceOpen: undefined
      })
    ])
    expect(useAppStore.getState().setActiveWorktree).not.toHaveBeenCalled()
  })

  const switches: { worktree: Worktree; switchTo: WorkspaceLaunchSwitch }[] = [
    {
      worktree: remoteFeat,
      switchTo: { executionHostId: 'runtime:env-b', machineLabel: 'Second Mac' }
    },
    { worktree: localFeat, switchTo: { executionHostId: 'local', machineLabel: 'This Mac' } }
  ]
  it.each(switches)(
    "switches to $switchTo.machineLabel's workspace before its surface opens, with no extra shell",
    ({ worktree, switchTo }) => {
      useAppStore.setState({
        worktreesByRepo: { [worktree.repoId]: [worktree] },
        activeGroupIdByWorktree: { [worktree.id]: 'gb' }
      })
      launchAgentInWorkspace({ worktreeId: worktree.id, agent: 'codex', switchTo })
      const s = useAppStore.getState()
      expect(launches).toEqual([
        expect.objectContaining({ worktreeId: worktree.id, groupId: 'gb' })
      ])
      expect(s.setActiveWorktree).toHaveBeenCalledWith(worktree.id, switchTo.executionHostId)
      expect(s.revealWorktreeInSidebar).toHaveBeenCalledWith(worktree.id, {
        executionHostId: switchTo.executionHostId
      })
      expect(s.createTab).not.toHaveBeenCalled()
    }
  )

  it('refuses the launch when that workspace is gone', () => {
    useAppStore.setState({ worktreesByRepo: {} })
    launchAgentInWorkspace({
      worktreeId: remoteFeat.id,
      agent: 'codex',
      switchTo: { executionHostId: 'runtime:env-b', machineLabel: 'Second Mac' }
    })
    expect(useAppStore.getState().setActiveWorktree).not.toHaveBeenCalled()
    expect(toast.error).toHaveBeenCalledWith('Could not open codex on Second Mac.')
    expect(firstShellHeld()).toBe(false)
  })
})
