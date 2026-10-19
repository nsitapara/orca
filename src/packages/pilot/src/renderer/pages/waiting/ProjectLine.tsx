import { Folder } from 'lucide-react'
import { cardCount, NO_PROJECT_NAME, type ProjectSections } from './inbox-projects'

function plural(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? '' : 's'}`
}

// Above a project's worktree sections: its name, and how many worktrees and cards it has here. Not a heading: the
// worktree headings below are h2 above the card titles' h3, and name the project themselves.
function ProjectLine({ project }: { project: ProjectSections }): React.JSX.Element {
  const cards = plural(cardCount(project), 'card')
  const summary =
    project.name === null ? cards : `${plural(project.sections.length, 'worktree')} · ${cards}`
  return (
    <p className="flex min-w-0 items-center gap-2 border-b border-border pb-1.5 text-sm font-semibold text-foreground">
      <Folder aria-hidden className="size-4 shrink-0 text-muted-foreground" />
      <span className="truncate">{project.name ?? NO_PROJECT_NAME}</span>
      <span className="shrink-0 text-xs font-normal text-muted-foreground">{summary}</span>
    </p>
  )
}

// A project's sections, in the cards and in Rows, under its line.
export function ProjectBlock({
  project,
  children
}: {
  project: ProjectSections
  children: React.ReactNode
}): React.JSX.Element {
  return (
    <div
      role="group"
      aria-label={project.name ?? NO_PROJECT_NAME}
      className="mt-3 flex min-w-0 flex-col gap-3 first:mt-0"
    >
      <ProjectLine project={project} />
      {children}
    </div>
  )
}
