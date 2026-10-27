import React from 'react'
import { Bell, ExternalLink, X } from 'lucide-react'
import {
  EventTime,
  ThreadAgentStateIndicator
} from '@/components/activity/activity-thread-controls'
import { ActivityThreadHoverCard } from '@/components/activity/activity-thread-hover-card'
import { activityThreadRowCopy } from '@/components/activity/activity-thread-presentation'
import { ActivityThreadRow } from '@/components/activity/activity-thread-row'
import type { AgentPaneThread } from '@/components/activity/activity-thread-types'
import { FilledBellIcon } from '@/components/sidebar/WorktreeCardHelpers'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { translate } from '@/i18n/i18n'
import { AgentIcon } from '@/lib/agent-catalog'
import { agentTypeToIconAgent, formatAgentTypeLabel } from '@/lib/agent-status'
import { cn } from '@/lib/utils'
import { isAutomationTabTitle } from '../../shared/automation-tab-title'
import { AutomationRunRowIcon } from '../automation-tab/AutomationRunGlyph'
import { pilotStore } from '../store'
import { RowWorkspaceLabel } from './RowWorkspaceLabel'

type RowProps = React.ComponentProps<typeof ActivityThreadRow>

const ACTION_CLASS =
  'flex size-3.5 shrink-0 cursor-pointer items-center justify-center rounded text-muted-foreground hover:bg-accent/80 hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring'
const SHOW_ON_HOVER =
  'transition-opacity can-hover:opacity-0 can-hover:group-hover:opacity-100 focus-visible:opacity-100'

// The row selects on click; its buttons only act.
function stop(event: React.SyntheticEvent): void {
  event.stopPropagation()
}

function RowAction({
  label,
  onClick,
  className,
  disabled,
  children
}: {
  label: string
  onClick: () => void
  className?: string
  disabled?: boolean
  children: React.ReactNode
}): React.JSX.Element {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          aria-label={label}
          disabled={disabled}
          onMouseDown={stop}
          onClick={(event) => {
            event.stopPropagation()
            onClick()
          }}
          className={cn(ACTION_CLASS, className)}
        >
          {children}
        </button>
      </TooltipTrigger>
      <TooltipContent side="left">{label}</TooltipContent>
    </Tooltip>
  )
}

// An automation's session shows the automation icon where its agent's was, as its tab does.
function ThreadAgentIcon({ thread }: { thread: AgentPaneThread }): React.JSX.Element {
  const label = formatAgentTypeLabel(thread.agentType)
  if (isAutomationTabTitle(thread.tab.customTitle)) {
    return <AutomationRunRowIcon agentLabel={label} />
  }
  return (
    <span className="inline-flex size-4 shrink-0 items-center justify-center" title={label}>
      <AgentIcon agent={agentTypeToIconAgent(thread.agentType)} size={14} />
    </span>
  )
}

const MARK_READ = () =>
  translate('auto.components.activity.ActivityPrototypePage.markThreadRead', 'Mark thread as read')
const MARK_UNREAD = () =>
  translate('auto.components.activity.ActivityPrototypePage.59b131fbd9', 'Mark thread unread')

/** Upstream's session row, its selection, actions and hover card kept, on one line. */
const TerseThreadRow = React.memo(function TerseThreadRow({
  thread,
  selected,
  multiSelected = false,
  onSelect,
  onJump,
  onMarkRead,
  onMarkUnread,
  onClear,
  canJump,
  disableMarkUnread = false,
  showJumpAction = true,
  previewSuppressed = false
}: RowProps): React.JSX.Element {
  const { taskTitle, statusLine, needsAttention } = activityThreadRowCopy(thread)
  return (
    <ActivityThreadHoverCard
      thread={thread}
      onJumpToWorkspace={onJump}
      canJumpToWorkspace={canJump}
      suppressed={previewSuppressed}
    >
      <div
        data-current={selected ? 'true' : undefined}
        data-worktree-card-surface="true"
        data-worktree-card-active={selected ? 'primary' : undefined}
        data-worktree-card-selected={multiSelected || undefined}
        onClick={(event) => onSelect(thread, event)}
        role="listitem"
        aria-label={taskTitle}
        aria-current={selected ? 'true' : undefined}
        className="group relative flex w-full min-w-0 cursor-pointer items-center gap-1.5 rounded-lg border border-transparent px-1.5 py-1 text-left transition-[background-color,border-color,opacity,box-shadow] duration-200 outline-none select-none worktree-sidebar-card-hover focus-visible:ring-1 focus-visible:ring-ring"
      >
        <ThreadAgentStateIndicator thread={thread} />
        <ThreadAgentIcon thread={thread} />
        {/* Keep the activation target apart from the row's actions. */}
        <button
          type="button"
          aria-label={taskTitle}
          aria-keyshortcuts="Enter Space"
          onClick={(event) => {
            event.stopPropagation()
            onSelect(thread, event)
          }}
          className="block min-w-0 flex-1 cursor-pointer truncate text-left text-[13px] leading-5 outline-none focus-visible:ring-1 focus-visible:ring-ring"
        >
          <span className={cn('text-foreground', thread.unread ? 'font-semibold' : 'font-medium')}>
            {taskTitle}
          </span>
          {statusLine ? (
            <span className={needsAttention ? 'text-agent-question-text' : 'text-muted-foreground'}>
              {' - '}
              {statusLine}
            </span>
          ) : null}
        </button>
        <RowWorkspaceLabel worktree={thread.worktree} repo={thread.repo} />
        {canJump && showJumpAction ? (
          <RowAction
            label={translate(
              'auto.components.activity.ActivityPrototypePage.4616ea39fd',
              'Jump to workspace'
            )}
            onClick={() => onJump(thread)}
            className={SHOW_ON_HOVER}
          >
            <ExternalLink className="size-2.5" />
          </RowAction>
        ) : null}
        {onClear ? (
          <RowAction
            label={translate(
              'auto.components.activity.ActivityThreadRow.clearNotification',
              'Clear notification'
            )}
            onClick={() => onClear(thread)}
            className={SHOW_ON_HOVER}
          >
            <X className="size-2.5" />
          </RowAction>
        ) : null}
        {thread.unread ? (
          <RowAction label={MARK_READ()} onClick={() => onMarkRead(thread)}>
            <FilledBellIcon className="size-3 shrink-0 text-annotation-highlight drop-shadow-sm" />
          </RowAction>
        ) : (
          <RowAction
            label={MARK_UNREAD()}
            disabled={disableMarkUnread}
            onClick={() => onMarkUnread(thread)}
            className={SHOW_ON_HOVER}
          >
            <Bell className="size-2.5" />
          </RowAction>
        )}
        <EventTime timestamp={thread.latestTimestamp} compact />
        {/* Fills while the pointer rests; the hover card sets the attribute. Duration = rest minus progress delay. */}
        <span
          aria-hidden="true"
          className="pointer-events-none absolute inset-x-2 bottom-0 h-px origin-left scale-x-0 rounded-full bg-muted-foreground/50 group-data-[hover-card-resting]:scale-x-100 group-data-[hover-card-resting]:transition-transform group-data-[hover-card-resting]:duration-400 group-data-[hover-card-resting]:ease-linear motion-reduce:hidden"
        />
      </div>
    </ActivityThreadHoverCard>
  )
})

// pilot-hook: activity-tabs-thread-row. With Pilot attached, an agent session is one line, as in the
// Projects sidebar: its state, its agent (an automation's shows the automation icon), the title and
// latest status, then mark read/unread and the time. The whole latest message is in its hover card.
// Grouped by worktree the header names the worktree; grouped otherwise the line names it too.
export const ActivityTabsThreadRow = React.memo(function ActivityTabsThreadRow(
  props: RowProps
): React.JSX.Element {
  return pilotStore() ? <TerseThreadRow {...props} /> : <ActivityThreadRow {...props} />
})
