import type { AgentArtifact } from '../../shared/api-types-artifacts'

// pilotcli stores absolute paths (git's top level, or the folder); Orca's worktree paths are absolute too. Only a
// trailing separator can differ.
export function normalizeArtifactPath(path: string): string {
  const trimmed = path.replace(/[/\\]+$/, '')
  return trimmed === '' ? path : trimmed
}

export type ArtifactsByWorktree = ReadonlyMap<string, readonly AgentArtifact[]>

function newestFirst(a: AgentArtifact, b: AgentArtifact): number {
  return b.last_published.localeCompare(a.last_published)
}

/** Each worktree or folder an artifact was published from, to its artifacts, newest first. */
export function indexArtifactsByWorktree(artifacts: readonly AgentArtifact[]): ArtifactsByWorktree {
  const index = new Map<string, AgentArtifact[]>()
  for (const artifact of artifacts) {
    for (const path of new Set(artifact.worktrees.map(normalizeArtifactPath))) {
      const list = index.get(path) ?? []
      list.push(artifact)
      index.set(path, list)
    }
  }
  for (const list of index.values()) {
    list.sort(newestFirst)
  }
  return index
}

const NONE: readonly AgentArtifact[] = []

export function artifactsForWorktree(
  index: ArtifactsByWorktree,
  path: string | null | undefined
): readonly AgentArtifact[] {
  return path ? (index.get(normalizeArtifactPath(path)) ?? NONE) : NONE
}
