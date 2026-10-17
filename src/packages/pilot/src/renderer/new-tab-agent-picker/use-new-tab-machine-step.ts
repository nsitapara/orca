import { useEffect, useMemo } from 'react'
import { ensureDetectedAgentsForWorktree } from '@/lib/agent-detection-target-inventory'
import { useAppStore } from '@/store'
import { buildExecutionHostRegistry } from '../../../../../shared/execution-host-registry'
import { getHostDisplayLabelOverrides } from '../../../../../shared/host-setting-overrides'
import { parseWorkspaceKey } from '../../../../../shared/workspace-scope'
import type { AppState } from '@/store/types'
import { buildNewTabMachineStep, type NewTabMachineStep } from './new-tab-machine-step'

// Why: shared constants keep a closed picker's selectors referentially stable.
const NO_REPOS: AppState['repos'] = []
const NO_SETUPS: AppState['projectHostSetups'] = []
const NO_WORKTREES: AppState['worktreesByRepo'] = {}
const NO_LABELS: AppState['sshTargetLabels'] = new Map()
const NO_SSH_STATES: AppState['sshConnectionStates'] = new Map()
const NO_RUNTIMES: AppState['runtimeEnvironments'] = []
const NO_RUNTIME_STATUS: AppState['runtimeStatusByEnvironmentId'] = new Map()

function otherWorktreeIds(step: NewTabMachineStep | null): string[] {
  return step ? step.targets.filter((t) => !t.isCurrent).map((t) => t.worktreeId) : []
}

export function useNewTabMachineStep(
  activeWorktreeId: string | null,
  enabled: boolean
): NewTabMachineStep | null {
  const activeWorktree = useAppStore((s) => {
    if (!enabled || !activeWorktreeId || parseWorkspaceKey(activeWorktreeId)?.type === 'folder') {
      return undefined
    }
    return s.getKnownWorktreeById(activeWorktreeId, s.activeWorkspaceExecutionHostId ?? undefined)
  })
  const repos = useAppStore((s) => (enabled ? s.repos : NO_REPOS))
  const projectHostSetups = useAppStore((s) => (enabled ? s.projectHostSetups : NO_SETUPS))
  const worktreesByRepo = useAppStore((s) => (enabled ? s.worktreesByRepo : NO_WORKTREES))
  const settings = useAppStore((s) => (enabled ? s.settings : null))
  const sshTargetLabels = useAppStore((s) => (enabled ? s.sshTargetLabels : NO_LABELS))
  const sshConnectionStates = useAppStore((s) => (enabled ? s.sshConnectionStates : NO_SSH_STATES))
  const runtimeEnvironments = useAppStore((s) => (enabled ? s.runtimeEnvironments : NO_RUNTIMES))
  const runtimeStatusByEnvironmentId = useAppStore((s) =>
    enabled ? s.runtimeStatusByEnvironmentId : NO_RUNTIME_STATUS
  )

  const step = useMemo(() => {
    if (!enabled || !activeWorktree || !settings) {
      return null
    }
    const hosts = buildExecutionHostRegistry({
      repos,
      settings,
      hostSource: 'configured-only',
      sshTargetLabels,
      sshConnectionStates,
      runtimeEnvironments,
      runtimeStatusByEnvironmentId,
      hostLabelOverrides: getHostDisplayLabelOverrides(settings)
    })
    return buildNewTabMachineStep({
      activeWorktree,
      repos,
      projectHostSetups,
      hosts,
      worktreesByRepo
    })
  }, [
    enabled,
    activeWorktree,
    repos,
    settings,
    sshTargetLabels,
    sshConnectionStates,
    runtimeEnvironments,
    runtimeStatusByEnvironmentId,
    projectHostSetups,
    worktreesByRepo
  ])

  const warmKey = enabled ? otherWorktreeIds(step).join('\n') : ''
  useEffect(() => {
    if (!enabled || !warmKey) {
      return
    }
    for (const id of warmKey.split('\n')) {
      void ensureDetectedAgentsForWorktree(useAppStore.getState(), id)
    }
  }, [enabled, warmKey])

  return step
}
