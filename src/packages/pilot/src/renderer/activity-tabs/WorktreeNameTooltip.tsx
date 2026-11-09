import type React from 'react'
import { Copy } from 'lucide-react'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { copyText } from '../artifacts/artifact-actions'

// The tooltip's portal still bubbles to the header, which opens its worktree on click.
function stopRowEvent(event: React.SyntheticEvent): void {
  event.stopPropagation()
}

/**
 * Hovering a worktree header's title shows the worktree's folder name with a copy button, on every
 * header alike. It stays open while the pointer is on it, so the button can be reached.
 */
export function WorktreeNameTooltip({
  name,
  children
}: {
  name: string
  children: React.ReactNode
}): React.JSX.Element {
  return (
    <Tooltip delayDuration={300} disableHoverableContent={false}>
      <TooltipTrigger asChild>
        <span className="flex min-w-0 flex-1">{children}</span>
      </TooltipTrigger>
      <TooltipContent
        side="top"
        align="start"
        sideOffset={2}
        showArrow={false}
        variant="tab-preview-interactive"
        className="flex w-fit items-center gap-1.5 py-1 pl-2 pr-1"
        onClick={stopRowEvent}
        onMouseDown={stopRowEvent}
        onKeyDown={stopRowEvent}
      >
        <span className="min-w-0 truncate font-mono text-2xs">{name}</span>
        <button
          type="button"
          aria-label="Copy worktree name"
          onClick={() => void copyText(name, 'Worktree name copied')}
          className="flex size-5 shrink-0 cursor-pointer items-center justify-center rounded text-muted-foreground hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
        >
          <Copy className="size-3" />
        </button>
      </TooltipContent>
    </Tooltip>
  )
}
