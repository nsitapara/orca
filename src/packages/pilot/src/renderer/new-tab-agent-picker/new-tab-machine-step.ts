import { LOCAL_EXECUTION_HOST_ID, type ExecutionHostId } from '../../../../../shared/execution-host'
import type { ExecutionHostRegistryEntry } from '../../../../../shared/execution-host-registry'
import { isFloatingWorkspaceId } from '../../../../../shared/floating-workspace-worktree'
import { isHostLocalProjectId } from '../../../../../shared/project-host-setup-projection'
import type { ProjectHostSetup } from '../../../../../shared/project-types'
import type { Repo } from '../../../../../shared/repo-types'
import type { Worktree } from '../../../../../shared/worktree/types'
import { parseWorkspaceKey } from '../../../../../shared/workspace-scope'
import { getComposerEligibleRepos } from '@/lib/new-workspace-composer-repo'
import { getPaletteWorktreeExecutionHostId } from '@/lib/palette-repo-resolution'
import {
  buildProjectHostSetupOptions,
  type ReadyProjectHostSetupOption
} from '@/lib/project-host-setup-options'

export type NewTabMachineOpensIn = 'this-workspace' | 'same-branch' | 'main-checkout'

export type NewTabMachineTarget = {
  hostId: ExecutionHostId
  machineLabel: string
  worktreeId: string
  worktreeName: string
  opensIn: NewTabMachineOpensIn
  isCurrent: boolean
}

export type NewTabMachineStep = { projectId: string; targets: NewTabMachineTarget[] }

export type NewTabMachineStepInput = {
  activeWorktree: Worktree | undefined
  repos: readonly Repo[]
  projectHostSetups: readonly ProjectHostSetup[]
  hosts: readonly ExecutionHostRegistryEntry[]
  worktreesByRepo: Readonly<Record<string, readonly Worktree[]>>
}

// Why: a worktree with no host stamp is a plain local one.
export function worktreeMachineId(
  w: Pick<Worktree, 'id' | 'hostId' | 'runtimeOwnerEnvironmentId'>
): ExecutionHostId {
  return getPaletteWorktreeExecutionHostId(w) ?? LOCAL_EXECUTION_HOST_ID
}

function isWorktreeWorkspace(worktree: Worktree): boolean {
  const scope = parseWorkspaceKey(worktree.id)
  return scope?.type !== 'folder' && !isFloatingWorkspaceId(worktree.id)
}

function pickOpenableWorktree(
  active: Worktree,
  machineId: ExecutionHostId,
  candidates: readonly Worktree[]
): { worktree: Worktree; opensIn: NewTabMachineOpensIn } | null {
  const openable = candidates.filter(
    (w) => worktreeMachineId(w) === machineId && !w.isArchived && !w.isBare
  )
  const sameBranch = active.branch ? openable.find((w) => w.branch === active.branch) : undefined
  if (sameBranch) {
    return { worktree: sameBranch, opensIn: 'same-branch' }
  }
  const main = openable.find((w) => w.isMainWorktree)
  return main ? { worktree: main, opensIn: 'main-checkout' } : null
}

function buildTarget(
  active: Worktree,
  current: ExecutionHostId,
  option: ReadyProjectHostSetupOption,
  worktreesByRepo: NewTabMachineStepInput['worktreesByRepo']
): NewTabMachineTarget | null {
  const isCurrent = option.hostId === current
  const picked = isCurrent
    ? { worktree: active, opensIn: 'this-workspace' as const }
    : pickOpenableWorktree(active, option.hostId, worktreesByRepo[option.repoId] ?? [])
  if (!picked) {
    return null
  }
  return {
    hostId: option.hostId,
    machineLabel: option.label,
    worktreeId: picked.worktree.id,
    worktreeName: picked.worktree.displayName,
    opensIn: picked.opensIn,
    isCurrent
  }
}

export function buildNewTabMachineStep(input: NewTabMachineStepInput): NewTabMachineStep | null {
  const { activeWorktree: active } = input
  if (!active || !isWorktreeWorkspace(active)) {
    return null
  }
  const current = worktreeMachineId(active)
  const currentSetup = input.projectHostSetups.find(
    (s) => s.repoId === active.repoId && s.hostId === current
  )
  const projectId = currentSetup?.projectId ?? active.projectId
  if (!projectId || isHostLocalProjectId(projectId)) {
    return null
  }
  const options = buildProjectHostSetupOptions({
    projectId,
    projectHostSetups: input.projectHostSetups,
    eligibleRepos: getComposerEligibleRepos(input.repos),
    hosts: input.hosts.filter((h) => h.health === 'local' || h.health === 'available')
  })
  const targets: NewTabMachineTarget[] = []
  for (const option of options) {
    if (option.kind !== 'ready') {
      continue
    }
    const target = buildTarget(active, current, option, input.worktreesByRepo)
    if (target) {
      targets.push(target)
    }
  }
  if (targets.length < 2 || !targets.some((t) => t.isCurrent)) {
    return null
  }
  return { projectId, targets }
}
