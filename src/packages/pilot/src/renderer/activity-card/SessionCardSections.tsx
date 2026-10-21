import { History, MessageSquare } from 'lucide-react'
import {
  clearActivityThread,
  isClearableActivityThread
} from '@/components/activity/activity-clear-completed'
import {
  EventTime,
  ThreadAgentStateIndicator
} from '@/components/activity/activity-thread-controls'
import {
  activityThreadRowCopy,
  agentTitle,
  threadAgentStateLabel
} from '@/components/activity/activity-thread-presentation'
import type { ActivityEvent, AgentPaneThread } from '@/components/activity/activity-thread-types'
import CommentMarkdown from '@/components/sidebar/CommentMarkdown'
import { DetailHeader } from '@/components/sidebar/WorktreeCardMetadataControls'
import { Button } from '@/components/ui/button'
import { AgentIcon } from '@/lib/agent-catalog'
import { agentTypeToIconAgent, formatAgentTypeLabel } from '@/lib/agent-status'
import { cn } from '@/lib/utils'
import { useAppStore } from '@/store'

const HISTORY_LIMIT = 5

const clockFormatter = new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' })
const dayClockFormatter = new Intl.DateTimeFormat(undefined, {
  month: 'short',
  day: 'numeric',
  hour: 'numeric',
  minute: '2-digit'
})

function formatEventClock(timestamp: number, now = new Date()): string {
  const at = new Date(timestamp)
  return at.toDateString() === now.toDateString()
    ? clockFormatter.format(at)
    : dayClockFormatter.format(at)
}

/** The session's agent, state and task, and its latest message in full; the row clamps it. */
export function SessionSummary({ thread }: { thread: AgentPaneThread }): React.JSX.Element {
  const { taskTitle, needsAttention } = activityThreadRowCopy(thread)
  const preview = thread.responsePreview
  return (
    <section className="space-y-2">
      <div className="flex items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-1.5">
          <span className="inline-flex shrink-0">
            <AgentIcon agent={agentTypeToIconAgent(thread.agentType)} size={14} />
          </span>
          <span className="truncate text-[12px] font-semibold text-foreground">
            {formatAgentTypeLabel(thread.agentType)}
          </span>
        </div>
        <div className="flex shrink-0 items-center gap-1.5 text-[11px] text-muted-foreground">
          <ThreadAgentStateIndicator thread={thread} />
          <span
            className={cn(
              'text-[11px] font-medium capitalize',
              needsAttention ? 'text-agent-question-text' : 'text-muted-foreground'
            )}
          >
            {threadAgentStateLabel(thread)}
          </span>
          <span className="text-muted-foreground/40">•</span>
          <EventTime timestamp={thread.latestTimestamp} compact />
        </div>
      </div>
      <div className="break-words text-[12.5px] font-semibold leading-snug text-foreground">
        {taskTitle}
      </div>
      {preview ? (
        <div className="space-y-1.5">
          <DetailHeader
            icon={<MessageSquare className="size-3 text-muted-foreground" />}
            label="Latest message"
          />
          <div className="max-h-60 overflow-y-auto break-words rounded-md border border-border/40 bg-accent/40 p-2 text-[11.5px] leading-relaxed text-foreground/80 scrollbar-sleek">
            <CommentMarkdown
              content={preview}
              className="text-[11.5px] leading-relaxed [&_.comment-md-p]:block [&_.comment-md-p+.comment-md-p]:mt-1"
            />
          </div>
        </div>
      ) : null}
    </section>
  )
}

/** The session's last few state changes, oldest first; nothing until it has changed state. */
export function SessionHistory({
  events
}: {
  events: readonly ActivityEvent[]
}): React.JSX.Element | null {
  if (events.length < 2) {
    return null
  }
  // Events arrive newest first.
  const recent = events.slice(0, HISTORY_LIMIT).toReversed()
  return (
    <section className="space-y-1.5">
      <DetailHeader icon={<History className="size-3 text-muted-foreground" />} label="History" />
      <ol className="space-y-0.5">
        {recent.map((event) => (
          <li
            key={event.id}
            className="flex items-baseline justify-between gap-2 text-[11.5px] text-foreground/80"
          >
            <span className="min-w-0 truncate">{agentTitle(event)}</span>
            <span className="shrink-0 tabular-nums text-muted-foreground">
              {formatEventClock(event.timestamp)}
            </span>
          </li>
        ))}
      </ol>
    </section>
  )
}

/** Open the session, mark it read, or clear it once it needs nothing more. */
export function SessionActions({
  thread,
  closeHover,
  onJumpToWorkspace,
  canJumpToWorkspace
}: {
  thread: AgentPaneThread
  closeHover: () => void
  onJumpToWorkspace?: (thread: AgentPaneThread) => void
  canJumpToWorkspace?: boolean
}): React.JSX.Element | null {
  const canOpen = Boolean(onJumpToWorkspace) && canJumpToWorkspace !== false
  const canClear = isClearableActivityThread(thread)
  if (!canOpen && !thread.unread && !canClear) {
    return null
  }
  const run = (action: () => void) => () => {
    closeHover()
    action()
  }
  return (
    <div className="flex flex-wrap gap-1.5 border-t border-border/40 pt-2.5">
      {canOpen ? (
        <Button size="xs" variant="outline" onClick={run(() => onJumpToWorkspace?.(thread))}>
          Open
        </Button>
      ) : null}
      {thread.unread ? (
        <Button
          size="xs"
          variant="outline"
          onClick={run(() =>
            useAppStore.getState().acknowledgeAgents([thread.paneKey], undefined, 'explicit')
          )}
        >
          Mark read
        </Button>
      ) : null}
      {canClear ? (
        <Button size="xs" variant="outline" onClick={run(() => clearActivityThread(thread))}>
          Clear
        </Button>
      ) : null}
    </div>
  )
}
