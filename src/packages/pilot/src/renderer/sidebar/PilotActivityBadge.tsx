import { PILOT_TAB } from '../../shared/sidebar-click'
import { useActiveWorktreePath } from './active-worktree'
import { badgeFor } from './badge'
import { useWorktreeTimeline } from './timeline-feed'

const PLACE: Record<'top' | 'side', string> = {
  top: 'top-[5px] right-[2px]',
  side: 'top-[4px] right-[3px]'
}

function Badge({ layout }: { layout: 'top' | 'side' }): React.JSX.Element | null {
  const path = useActiveWorktreePath()
  const { data } = useWorktreeTimeline(path)
  const badge = badgeFor(data)
  if (badge.kind === 'none') {
    return null
  }
  if (badge.kind === 'dot') {
    return (
      <span
        aria-label="An automation is running here"
        className={`absolute ${PLACE[layout]} size-[7px] rounded-full bg-sky-500 ring-1 ring-sidebar`}
      />
    )
  }
  return (
    <span
      aria-label={`${badge.count} waiting on you`}
      className={`absolute ${PLACE[layout]} min-w-[14px] rounded-full bg-amber-500 px-1 text-center text-[9px] font-semibold leading-[14px] text-white ring-1 ring-sidebar`}
    >
      {badge.label}
    </span>
  )
}

// pilot-hook: right-sidebar-badge. Rendered inside every activity-bar button; draws only on Pilot's, and only
// once Pilot has attached (no store → no worktree → no poll).
export function PilotActivityBadge({
  itemId,
  layout
}: {
  itemId: string
  layout: 'top' | 'side'
}): React.JSX.Element | null {
  if (itemId !== PILOT_TAB) {
    return null
  }
  return <Badge layout={layout} />
}
