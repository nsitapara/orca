import { useState } from 'react'
import { ExternalLink, Plug } from 'lucide-react'
import type { Repo } from '../../../../../shared/repo-types'
import type { WorkspacePort } from '../../../../../shared/workspace-ports'
import type { Worktree } from '../../../../../shared/worktree/types'
import {
  WorktreeCardDetailSection,
  WorktreeCardDetailSectionContent
} from '@/components/sidebar/WorktreeCardDetailSection'
import { DetailHeader, MetadataActionIcon } from '@/components/sidebar/WorktreeCardMetadataControls'
import { WorktreeCardPortsDetails } from '@/components/sidebar/WorktreeCardPorts'
import { openHttpLink } from '@/lib/http-link-routing'
import type { StackPort } from './stack-ports'
import { useStackPorts } from './use-stack-ports'

function otherPortsLabel(count: number): string {
  return count === 1 ? '+1 other live port' : `+${count} other live ports`
}

function StackPortRow({ port, worktreeId }: { port: StackPort; worktreeId: string }) {
  const { url } = port
  const open = (event: React.MouseEvent) => {
    if (url) {
      openHttpLink(url, { worktreeId, modifierHeld: event.shiftKey })
    }
  }
  return (
    <div className="flex min-w-0 items-center gap-2 rounded-md px-1.5 py-0.5 hover:bg-accent/50">
      {url ? (
        <button
          type="button"
          onClick={open}
          title={url}
          className="min-w-0 shrink cursor-pointer truncate text-left text-[12px] font-medium text-foreground hover:underline focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
        >
          {port.label}
        </button>
      ) : (
        <span className="min-w-0 shrink truncate text-[12px] text-muted-foreground">
          {port.label}
        </span>
      )}
      <span className="shrink-0 font-mono text-[11px] tabular-nums text-muted-foreground">
        :{port.port}
      </span>
      <span className="min-w-0 flex-1 truncate text-[11px] text-muted-foreground/70">
        {port.live.processName}
      </span>
      {url ? (
        <MetadataActionIcon label={`Open ${port.label}`} onClick={open}>
          <ExternalLink className="size-3" />
        </MetadataActionIcon>
      ) : null}
    </div>
  )
}

/**
 * The worktree's live ports. With a `.env.ports`, its stack's ports lead by name (web pages first,
 * as links) and every other live port folds away; without one, upstream's Live Ports list.
 */
export function HoverCardPorts({
  worktree,
  repo,
  ports
}: {
  worktree: Worktree
  repo: Repo | null
  ports: WorkspacePort[]
}): React.JSX.Element | null {
  const { stack, others } = useStackPorts(worktree, repo, ports)
  const [showOthers, setShowOthers] = useState(false)
  if (stack.length === 0) {
    return ports.length > 0 ? <WorktreeCardPortsDetails ports={ports} /> : null
  }
  return (
    <>
      <WorktreeCardDetailSection>
        <DetailHeader
          icon={<Plug className="size-3 text-muted-foreground" />}
          label={`Stack ports (${stack.length})`}
        />
        <WorktreeCardDetailSectionContent className="space-y-0.5">
          {stack.map((port) => (
            <StackPortRow key={port.envVar} port={port} worktreeId={worktree.id} />
          ))}
          {others.length > 0 ? (
            <button
              type="button"
              aria-expanded={showOthers}
              onClick={() => setShowOthers(!showOthers)}
              className="cursor-pointer px-1.5 pt-0.5 text-[11px] text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
            >
              {showOthers ? 'Hide other live ports' : otherPortsLabel(others.length)}
            </button>
          ) : null}
        </WorktreeCardDetailSectionContent>
      </WorktreeCardDetailSection>
      {showOthers ? <WorktreeCardPortsDetails ports={others} /> : null}
    </>
  )
}
