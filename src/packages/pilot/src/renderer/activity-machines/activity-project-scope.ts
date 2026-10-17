import { getRepoExecutionHostId } from '../../../../../shared/execution-host'
import type { ProjectHostSetup } from '../../../../../shared/project-types'
import {
  getProjectIdentityKey,
  isHostLocalProjectId
} from '../../../../../shared/project-host-setup-projection'
import type { Repo } from '../../../../../shared/repo-types'

export type ProjectIdByRepoId = ReadonlyMap<string, string>

export function buildProjectIdByRepoId(
  repos: readonly Repo[],
  setups: readonly Pick<ProjectHostSetup, 'repoId' | 'projectId'>[]
): ProjectIdByRepoId {
  const index = new Map<string, string>()
  for (const setup of setups) {
    index.set(setup.repoId, setup.projectId)
  }
  for (const repo of repos) {
    if (!index.has(repo.id)) {
      index.set(repo.id, getProjectIdentityKey(repo))
    }
  }
  return index
}

/** Widens each picked repo to every machine's copy of its project. */
export function expandProjectRepoIds(
  filterRepoIds: readonly string[],
  repos: readonly Pick<Repo, 'id'>[],
  projectIdByRepoId: ProjectIdByRepoId
): readonly string[] {
  const projectIds = new Set<string>()
  for (const id of filterRepoIds) {
    const projectId = projectIdByRepoId.get(id)
    if (projectId && !isHostLocalProjectId(projectId)) {
      projectIds.add(projectId)
    }
  }
  const have = new Set(filterRepoIds)
  const added = repos
    .filter((repo) => !have.has(repo.id) && projectIds.has(projectIdByRepoId.get(repo.id) ?? ''))
    .map((repo) => repo.id)
  return added.length === 0 ? filterRepoIds : [...filterRepoIds, ...added]
}

export type ActivityProjectChoices = { choices: Repo[]; selected: Repo[] }

function choiceKey(repo: Repo, projectIdByRepoId: ProjectIdByRepoId): string {
  const projectId = projectIdByRepoId.get(repo.id) ?? getProjectIdentityKey(repo)
  // Remote-less repos share an id shape only per machine, so keep each machine apart.
  return isHostLocalProjectId(projectId)
    ? `${projectId}\0${getRepoExecutionHostId(repo)}`
    : projectId
}

export function buildActivityProjectChoices(
  repos: readonly Repo[],
  filterRepoIds: readonly string[],
  projectIdByRepoId: ProjectIdByRepoId
): ActivityProjectChoices {
  const groups = new Map<string, Repo[]>()
  for (const repo of repos) {
    const key = choiceKey(repo, projectIdByRepoId)
    const copies = groups.get(key)
    if (copies) {
      copies.push(repo)
    } else {
      groups.set(key, [repo])
    }
  }
  const picked = new Set(filterRepoIds)
  const choices: Repo[] = []
  const selected: Repo[] = []
  for (const copies of groups.values()) {
    // An SSH copy stands in only when no copy is reachable directly.
    const representative = copies.find((copy) => !copy.connectionId) ?? copies[0]
    choices.push(representative)
    if (copies.some((copy) => picked.has(copy.id))) {
      selected.push(representative)
    }
  }
  return { choices, selected }
}
