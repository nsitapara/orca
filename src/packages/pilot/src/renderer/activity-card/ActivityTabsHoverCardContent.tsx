import type { AgentPaneThread } from '@/components/activity/activity-thread-types'
import { SelectedTextCopyMenu } from '@/components/SelectedTextCopyMenu'
import { WORKTREE_NATIVE_CONTEXT_MENU_ATTR } from '@/components/sidebar/WorktreeContextMenu'
import type { useWorktreeCardDetailsHoverControl } from '@/components/sidebar/worktree-card-details-hover-state'
import { HoverCardContent } from '@/components/ui/hover-card'
import { pilotStore } from '../store'
import { SessionActions, SessionHistory, SessionSummary } from './SessionCardSections'

type ContentProps = {
  thread: AgentPaneThread
  detailsHoverControl: ReturnType<typeof useWorktreeCardDetailsHoverControl>
  onJumpToWorkspace?: (thread: AgentPaneThread) => void
  canJumpToWorkspace?: boolean
}

function PilotSessionCard({
  thread,
  detailsHoverControl,
  onJumpToWorkspace,
  canJumpToWorkspace
}: ContentProps): React.JSX.Element {
  return (
    <HoverCardContent
      side="right"
      align="start"
      sideOffset={8}
      className="w-80 max-h-[30rem] overflow-y-auto p-3 text-xs scrollbar-sleek"
      {...{ [WORKTREE_NATIVE_CONTEXT_MENU_ATTR]: '' }}
      onClick={(event) => event.stopPropagation()}
      onDoubleClick={(event) => event.stopPropagation()}
    >
      <SelectedTextCopyMenu className="space-y-3">
        <SessionSummary thread={thread} />
        <SessionHistory events={thread.events} />
        <SessionActions
          thread={thread}
          closeHover={detailsHoverControl.closeHover}
          onJumpToWorkspace={onJumpToWorkspace}
          canJumpToWorkspace={canJumpToWorkspace}
        />
      </SelectedTextCopyMenu>
    </HoverCardContent>
  )
}

// pilot-hook: activity-tabs-hover-card. A session's hover card is about that session alone: its
// agent and state, its latest message in full, its recent states, and Open / Mark read / Clear.
// The worktree's MR, Linear issue and ports sit on its header instead. Upstream's card
// (`fallback`) renders until Pilot attaches.
export function ActivityTabsHoverCardContent({
  fallback: Upstream,
  ...props
}: ContentProps & { fallback: (props: ContentProps) => React.JSX.Element }): React.JSX.Element {
  if (!pilotStore()) {
    return <Upstream {...props} />
  }
  return <PilotSessionCard {...props} />
}
