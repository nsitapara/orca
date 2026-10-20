import { useState } from 'react'
import {
  EventTime,
  ThreadAgentStateIndicator
} from '@/components/activity/activity-thread-controls'
import {
  activityThreadRowCopy,
  threadAgentStateLabel
} from '@/components/activity/activity-thread-presentation'
import type { AgentPaneThread } from '@/components/activity/activity-thread-types'
import CommentMarkdown from '@/components/sidebar/CommentMarkdown'
import { AgentIcon } from '@/lib/agent-catalog'
import { agentTypeToIconAgent, formatAgentTypeLabel } from '@/lib/agent-status'
import { cn } from '@/lib/utils'

// Past this the clamp likely hides some of the message, so the card offers the rest.
const LONG_PREVIEW_CHARS = 160

/** The session's state, task and latest message: last, and clamped, since its row already shows them. */
export function HoverCardAgentSummary({ thread }: { thread: AgentPaneThread }): React.JSX.Element {
  const [expanded, setExpanded] = useState(false)
  const { taskTitle, needsAttention } = activityThreadRowCopy(thread)
  const preview = thread.responsePreview
  return (
    <section className="space-y-1.5 border-t border-border/40 pt-2.5">
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
        <>
          <div
            className={cn(
              'break-words rounded-md border border-border/40 bg-accent/40 p-2 text-[11.5px] leading-relaxed text-foreground/80',
              expanded ? 'max-h-36 overflow-y-auto scrollbar-sleek' : 'max-h-18 overflow-hidden'
            )}
          >
            <CommentMarkdown
              content={preview}
              className="text-[11.5px] leading-relaxed [&_*]:!m-0 [&_*]:!p-0"
            />
          </div>
          {preview.length > LONG_PREVIEW_CHARS ? (
            <button
              type="button"
              aria-expanded={expanded}
              onClick={() => setExpanded(!expanded)}
              className="cursor-pointer text-[11px] text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
            >
              {expanded ? 'Show less' : 'Show message'}
            </button>
          ) : null}
        </>
      ) : null}
    </section>
  )
}
