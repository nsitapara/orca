import type { HostedSection } from '../../hosts/hosted-sections'
import { WorktreeName } from './WorktreeLink'

// A worktree's heading names its project, so it still says where it is while pinned.
export function SectionHeading({
  section,
  project
}: {
  section: HostedSection
  project?: string | null
}): React.JSX.Element {
  return (
    <h2
      title={project ? `${project} / ${section.group.label}` : section.group.label}
      className="sticky top-0 z-20 -mx-5 truncate border-b border-border bg-background px-5 py-1.5 font-mono text-xs font-semibold text-muted-foreground"
    >
      {project ? <span className="font-normal">{project} / </span> : null}
      <WorktreeName group={section.group} host={section.host} /> · {section.items.length}
    </h2>
  )
}
