import type { HostedSection } from '../../hosts/hosted-sections'
import { isWorktreeGroup, repoNameForPath } from './WorktreeLink'

// The sections under one project heading: a project's worktrees, or (name null) the cards no worktree holds.
export type ProjectSections = { key: string; name: string | null; sections: HostedSection[] }

export const NO_PROJECT_NAME = 'Not in a worktree'

// Worktrees sit at <worktrees>/<project>/<name>, so a worktree the app doesn't list is named by its parent folder.
function parentFolder(path: string): string | null {
  const parts = path.split(/[\\/]+/).filter(Boolean)
  return parts.at(-2) ?? parts.at(-1) ?? null
}

// The project a worktree section's worktree belongs to; null for a section that is not a worktree.
export function projectOf(
  section: HostedSection,
  repoName: (path: string) => string | null = repoNameForPath
): string | null {
  if (!isWorktreeGroup(section.group)) {
    return null
  }
  const path = section.group.key.slice('wt:'.length)
  return repoName(path) ?? parentFolder(path)
}

export function cardCount(project: ProjectSections): number {
  return project.sections.reduce((n, s) => n + s.items.length, 0)
}

// Each project where its first section was, its sections in their order; the sections with no project last.
export function groupByProject(
  sections: readonly HostedSection[],
  nameOf: (section: HostedSection) => string | null = projectOf
): ProjectSections[] {
  const projects = new Map<string, ProjectSections>()
  for (const section of sections) {
    const name = nameOf(section)
    const key = name === null ? 'project:none' : `project:${name}`
    const project = projects.get(key) ?? { key, name, sections: [] }
    project.sections.push(section)
    projects.set(key, project)
  }
  const all = [...projects.values()]
  return [...all.filter((p) => p.name !== null), ...all.filter((p) => p.name === null)]
}
