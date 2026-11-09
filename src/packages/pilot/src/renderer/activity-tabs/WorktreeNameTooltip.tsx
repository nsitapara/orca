import type React from 'react'
import { useRef, useState } from 'react'
import { Copy } from 'lucide-react'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { copyText } from '../artifacts/artifact-actions'

// The tooltip's portal still bubbles to the header, which opens its worktree on click.
function stopRowEvent(event: React.SyntheticEvent): void {
  event.stopPropagation()
}

/**
 * Hovering a worktree header's title shows the worktree's folder name with a copy button, on every
 * header alike, and above it the whole `title` when the header cut it short. It stays open while
 * the pointer is on it, so the button can be reached.
 */
export function WorktreeNameTooltip({
  name,
  title,
  children
}: {
  name: string
  title: string
  children: React.ReactNode
}): React.JSX.Element {
  const trigger = useRef<HTMLSpanElement>(null)
  const [cut, setCut] = useState(false)
  return (
    <span className="flex min-w-0 flex-1">
      <Tooltip
        delayDuration={300}
        disableHoverableContent={false}
        onOpenChange={(open) => {
          if (open) {
            // The title's element holds only the words that fit.
            setCut(trigger.current?.textContent !== title)
          }
        }}
      >
        <TooltipTrigger asChild>
          <span ref={trigger} className="flex min-w-0">
            {children}
          </span>
        </TooltipTrigger>
        <NameTooltipContent name={name} title={cut ? title : null} />
      </Tooltip>
    </span>
  )
}

function NameTooltipContent({
  name,
  title
}: {
  name: string
  title: string | null
}): React.JSX.Element {
  return (
    <TooltipContent
      side="top"
      align="start"
      sideOffset={2}
      showArrow={false}
      variant="tab-preview-interactive"
      className="flex w-fit max-w-72 flex-col gap-0.5 py-1 pl-2 pr-1"
      onClick={stopRowEvent}
      onMouseDown={stopRowEvent}
      onKeyDown={stopRowEvent}
    >
      {title ? <span className="pr-1 text-2xs text-muted-foreground">{title}</span> : null}
      <span className="flex min-w-0 items-center gap-1.5">
        <span className="min-w-0 truncate font-mono text-2xs">{name}</span>
        <button
          type="button"
          aria-label="Copy worktree name"
          onClick={() => void copyText(name, 'Worktree name copied')}
          className="flex size-5 shrink-0 cursor-pointer items-center justify-center rounded text-muted-foreground hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
        >
          <Copy className="size-3" />
        </button>
      </span>
    </TooltipContent>
  )
}
