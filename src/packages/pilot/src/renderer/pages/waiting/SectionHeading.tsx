import { cn } from '@/lib/utils'
import type { HostedSection } from '../../hosts/hosted-sections'
import { WorktreeName } from './WorktreeLink'

// A worktree's heading names its project, so it still says where it is while pinned. It runs out to the page's edges
// so cards scroll cleanly under it, but stops short of the list beside it.
export function SectionHeading({
  section,
  project,
  besideList
}: {
  section: HostedSection
  project?: string | null
  besideList: boolean
}): React.JSX.Element {
  return (
    <h2
      title={project ? `${project} / ${section.group.label}` : section.group.label}
      className={cn(
        'sticky top-0 z-20 -mr-5 truncate border-b border-border bg-background py-1.5 pr-5 font-mono text-xs font-semibold text-muted-foreground',
        !besideList && '-ml-5 pl-5'
      )}
    >
      {project ? <span className="font-normal">{project} / </span> : null}
      <WorktreeName group={section.group} host={section.host} /> · {section.items.length}
    </h2>
  )
}
