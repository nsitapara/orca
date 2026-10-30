import type { AgentArtifact } from '../../shared/api-types-artifacts'
import { normalizeArtifactPath } from './artifacts-match'
import type { ArtifactsTab, ArtifactsView } from './artifacts-view'

export type ArtifactsListTab = Exclude<ArtifactsTab, 'shared'>

/** The tab that lists an artifact: a vault report, an id only the account knows, or a publish an agent made. */
export function artifactTab(artifact: AgentArtifact): ArtifactsListTab {
  if (artifact.source === 'local') {
    return 'local'
  }
  return artifact.tracked ? 'agents' : 'untracked'
}

export function tabCounts(artifacts: readonly AgentArtifact[]): Record<ArtifactsListTab, number> {
  const counts = { agents: 0, local: 0, untracked: 0 }
  for (const artifact of artifacts) {
    counts[artifactTab(artifact)] += 1
  }
  return counts
}

// ~/Documents/worktrees/<repo>/<name>
const WORKTREES_LAYOUT = /[/\\]worktrees[/\\]([^/\\]+)[/\\][^/\\]+$/

/**
 * The repo a worktree or folder belongs to: the project Orca knows it by, else the `worktrees/<repo>/<name>` folder
 * it sits in, else its own folder name (a main checkout, a folder workspace). Most artifacts outlive their worktree.
 */
export function repoOfPath(path: string, known: ReadonlyMap<string, string>): string {
  const normalized = normalizeArtifactPath(path)
  const name = known.get(normalized)
  if (name) {
    return name
  }
  const layout = WORKTREES_LAYOUT.exec(normalized)
  if (layout) {
    return layout[1]
  }
  return normalized.split(/[/\\]/).at(-1) ?? normalized
}

export function artifactRepos(
  artifact: AgentArtifact,
  known: ReadonlyMap<string, string>
): string[] {
  return [...new Set(artifact.worktrees.map((path) => repoOfPath(path, known)))]
}

/** The repos the agents' artifacts came from, for the repo filter. */
export function repoOptions(
  artifacts: readonly AgentArtifact[],
  known: ReadonlyMap<string, string>
): string[] {
  const repos = new Set<string>()
  for (const artifact of artifacts) {
    if (artifactTab(artifact) === 'agents') {
      for (const repo of artifactRepos(artifact, known)) {
        repos.add(repo)
      }
    }
  }
  return [...repos].sort((a, b) => a.localeCompare(b))
}

// Title, description, tickets, worktrees and branches (as pilotcli's --search), plus the job and a report's path.
function searchText(artifact: AgentArtifact): string {
  return [
    artifact.title,
    artifact.description,
    artifact.job,
    artifact.source === 'local' ? artifact.id : '',
    ...artifact.tickets,
    ...artifact.worktrees,
    ...artifact.contributions.flatMap((c) => [c.branch, c.worktree, c.job])
  ]
    .join('\n')
    .toLowerCase()
}

function newestFirst(a: AgentArtifact, b: AgentArtifact): number {
  return b.last_published.localeCompare(a.last_published)
}

/** One tab's rows: its search, and on From agents the repo and worktree filters; newest first. */
export function filterArtifacts(
  artifacts: readonly AgentArtifact[],
  view: Pick<ArtifactsView, 'query' | 'repo' | 'worktree'> & { tab: ArtifactsListTab },
  known: ReadonlyMap<string, string>
): AgentArtifact[] {
  const query = view.query.trim().toLowerCase()
  const worktree = view.worktree ? normalizeArtifactPath(view.worktree.path) : null
  return artifacts
    .filter((artifact) => {
      if (artifactTab(artifact) !== view.tab) {
        return false
      }
      if (view.tab === 'agents') {
        if (worktree && !artifact.worktrees.some((p) => normalizeArtifactPath(p) === worktree)) {
          return false
        }
        if (view.repo && !artifactRepos(artifact, known).includes(view.repo)) {
          return false
        }
      }
      return query === '' || searchText(artifact).includes(query)
    })
    .sort(newestFirst)
}
