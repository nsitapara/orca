import type { ExecutionHostId } from '../../../../../shared/execution-host'
import type {
  ExecutionHostHealth,
  ExecutionHostRegistryEntry
} from '../../../../../shared/execution-host-registry'
import type { ProjectHostSetup } from '../../../../../shared/project-types'
import type { Worktree } from '../../../../../shared/worktree/types'
import { makeWorktree } from '@/components/worktree-jump-palette-test-fixtures'

export const PROJECT = 'git:example.invalid/pilot/machine-step'

export function setup(
  repoId: string,
  hostId: ExecutionHostId,
  over: Partial<ProjectHostSetup> = {}
): ProjectHostSetup {
  return {
    id: `setup-${repoId}`,
    projectId: PROJECT,
    hostId,
    repoId,
    path: `/${repoId}`,
    displayName: repoId,
    setupState: 'ready',
    setupMethod: 'imported-existing-folder',
    createdAt: 0,
    updatedAt: 0,
    ...over
  }
}

export function host(
  id: ExecutionHostId,
  label: string,
  health: ExecutionHostHealth
): ExecutionHostRegistryEntry {
  return { id, kind: hostKind(id), label, detail: label, health }
}

function hostKind(id: ExecutionHostId): ExecutionHostRegistryEntry['kind'] {
  if (id === 'local') {
    return 'local'
  }
  return id.startsWith('ssh:') ? 'ssh' : 'runtime'
}

export function machineWorktree(
  repoId: string,
  path: string,
  over: Partial<Worktree> = {}
): Worktree {
  return makeWorktree(`${repoId}::${path}`, path, { repoId, path, ...over })
}
