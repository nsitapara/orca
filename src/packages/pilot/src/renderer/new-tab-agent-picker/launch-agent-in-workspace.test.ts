import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { toast } from 'sonner'
import type { LaunchAgentInNewTabArgs } from '@/lib/launch-agent-in-new-tab'
import {
  beginWebRuntimeInitialTerminalBootstrap,
  isWebRuntimeInitialTerminalBootstrapInFlight,
  resetWebRuntimeInitialTerminalBootstrapForTests
} from '@/runtime/web-runtime-initial-terminal-bootstrap'
import { clearWebSessionTabsTrackingForEnvironment } from '@/runtime/web-session-tabs-sync/tracking-lifecycle'
import { useAppStore } from '@/store'
import { makeTab } from '@/store/slices/store-session-test-harness'
import type { Worktree } from '../../../../../shared/worktree/types'
import { launchAgentInWorkspace, type WorkspaceLaunchSwitch } from './launch-agent-in-workspace'
import { machineWorktree } from './new-tab-machine-test-fixtures'

const launches = vi.hoisted((): LaunchAgentInNewTabArgs[] => [])
// Why: a structured launch can still come back null after its surface switch succeeded.
const failAfterSwitch = vi.hoisted(() => ({ value: false }))
vi.mock('@/lib/launch-agent-in-new-tab', () => ({
  launchAgentInNewTab: (args: LaunchAgentInNewTabArgs) => {
    launches.push(args)
    if (args.beforeSurfaceOpen?.({ kind: 'host-published' }) === false || failAfterSwitch.value) {
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
    failAfterSwitch.value = false
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

  it("releases the hold when the agent's tab never lands", () => {
    vi.useFakeTimers()
    useAppStore.setState({ worktreesByRepo: { [remoteFeat.repoId]: [remoteFeat] } })
    launchAgentInWorkspace({ worktreeId: remoteFeat.id, agent: 'codex', switchTo: toSecondMac })
    vi.advanceTimersByTime(30_000)
    expect(firstShellHeld()).toBe(false)
  })

  it('releases the hold when the launch fails after the switch', () => {
    failAfterSwitch.value = true
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
    expect(firstShellHeld()).toBe(false)
    expect(toast.error).toHaveBeenCalledWith('Could not open codex on Second Mac.')
  })

  it("leaves the seeder's later claim alone once a teardown freed the hold's", () => {
    vi.useFakeTimers()
    useAppStore.setState({ worktreesByRepo: { [remoteFeat.repoId]: [remoteFeat] } })
    launchAgentInWorkspace({ worktreeId: remoteFeat.id, agent: 'codex', switchTo: toSecondMac })
    clearWebSessionTabsTrackingForEnvironment('env-b')
    expect(beginWebRuntimeInitialTerminalBootstrap('env-b', remoteFeat.id)).toBe(true)
    vi.advanceTimersByTime(30_000)
    expect(firstShellHeld()).toBe(true)
  })

  // Why env-b: a hold keyed on the SSH target would show up as env-b's latch.
  const sshFeat = machineWorktree('repo-c', '/c/feat', { hostId: 'ssh:env-b' })
  const overSsh: WorkspaceLaunchSwitch = { executionHostId: 'ssh:env-b', machineLabel: 'Build Box' }
  const noHolds = [
    { name: 'a non-runtime host', worktree: sshFeat, switchTo: overSsh },
    { name: 'a workspace with tabs', worktree: remoteFeat, switchTo: toSecondMac, tabs: true },
    {
      name: 'a latch held elsewhere',
      worktree: remoteFeat,
      switchTo: toSecondMac,
      otherClaim: true
    },
    {
      name: 'a latch held elsewhere when the switch fails',
      worktree: remoteFeat,
      switchTo: toSecondMac,
      otherClaim: true,
      switchFails: true
    }
  ]
  it.each(noHolds)(
    'takes no hold for $name',
    ({ worktree, switchTo, tabs, otherClaim, switchFails }) => {
      vi.useFakeTimers()
      const held = (): boolean => isWebRuntimeInitialTerminalBootstrapInFlight('env-b', worktree.id)
      useAppStore.setState({
        worktreesByRepo: switchFails ? {} : { [worktree.repoId]: [worktree] },
        tabsByWorktree: tabs
          ? { [worktree.id]: [makeTab({ id: 'shell', worktreeId: worktree.id })] }
          : {}
      })
      if (otherClaim) {
        beginWebRuntimeInitialTerminalBootstrap('env-b', worktree.id)
      }
      launchAgentInWorkspace({ worktreeId: worktree.id, agent: 'codex', switchTo })
      expect(useAppStore.getState().setActiveWorktree).toHaveBeenCalledTimes(switchFails ? 0 : 1)
      expect(held()).toBe(otherClaim ?? false)
      vi.advanceTimersByTime(30_000)
      expect(held()).toBe(otherClaim ?? false)
    }
  )

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
