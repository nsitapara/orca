import type React from 'react'
import { Plug } from 'lucide-react'
import type { Repo } from '../../../../../shared/repo-types'
import type { WorkspacePort } from '../../../../../shared/workspace-ports'
import type { Worktree } from '../../../../../shared/worktree/types'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { getWorkspacePortsByWorktreeId } from '@/lib/workspace-port-groups'
import { useAppStore } from '@/store'
import { StackPortsList } from './StackPortsList'
import { useStackPorts } from './use-stack-ports'

const NO_PORTS: WorkspacePort[] = []

// The chip and its menu sit inside the worktree header, which opens the worktree on click or Enter.
function stopRowEvent(event: React.SyntheticEvent): void {
  event.stopPropagation()
}

/** The worktree's live ports, as the scan reports them. */
export function useWorktreeLivePorts(worktreeId: string): WorkspacePort[] {
  return useAppStore(
    (s) => getWorkspacePortsByWorktreeId(s.workspacePortScan?.result).get(worktreeId) ?? NO_PORTS
  )
}

/** "7 ports": the stack's live ports (or every live port, without a `.env.ports`); a click lists them. */
export function WorktreePortsChip({
  worktree,
  repo,
  ports
}: {
  worktree: Worktree
  repo: Repo | null
  ports: WorkspacePort[]
}): React.JSX.Element {
  const { stack } = useStackPorts(worktree, repo, ports)
  const count = stack.length > 0 ? stack.length : ports.length
  const label = count === 1 ? '1 port' : `${count} ports`
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label={`Show ${label}`}
          onClick={stopRowEvent}
          onMouseDown={stopRowEvent}
          onKeyDown={stopRowEvent}
          className="inline-flex shrink-0 cursor-pointer items-center gap-1 rounded border border-border/60 bg-muted/40 px-1 py-px text-[11px] font-medium leading-4 tabular-nums text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
        >
          <Plug className="size-3" />
          {label}
        </button>
      </PopoverTrigger>
      <PopoverContent
        side="bottom"
        align="start"
        className="w-72"
        onOpenAutoFocus={(event) => {
          // Focus the menu, not its first port: that port's tooltip would pop on every open.
          event.preventDefault()
          if (event.target instanceof HTMLElement) {
            event.target.focus()
          }
        }}
        onClick={stopRowEvent}
        onKeyDown={stopRowEvent}
        onContextMenu={stopRowEvent}
      >
        <StackPortsList worktree={worktree} repo={repo} ports={ports} />
      </PopoverContent>
    </Popover>
  )
}
