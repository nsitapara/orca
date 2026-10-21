import { cn } from '@/lib/utils'
import type { HostedSection } from '../../hosts/hosted-sections'

// A job, kind or age section's heading. It runs out to the page's edges so cards scroll cleanly under it, but stops
// short of the list beside it. A worktree's cards carry their own place, so a worktree has none.
export function SectionHeading({
  section,
  besideList
}: {
  section: HostedSection
  besideList: boolean
}): React.JSX.Element {
  return (
    <h2
      title={section.group.label}
      className={cn(
        'sticky top-0 z-20 -mr-5 truncate border-b border-border bg-background py-1.5 pr-5 font-mono text-xs font-semibold text-muted-foreground',
        !besideList && '-ml-5 pl-5'
      )}
    >
      {section.group.label} · {section.items.length}
    </h2>
  )
}
