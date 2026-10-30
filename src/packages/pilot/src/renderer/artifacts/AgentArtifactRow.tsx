import { Copy, ExternalLink } from 'lucide-react'
import { formatArtifactUpdatedCompact } from '@/components/artifacts/artifact-display-labels'
import { Button } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { isRowActivationKey } from '@/lib/list-row-interaction'
import {
  LIST_TABLE_ROW_CLASS,
  LIST_TABLE_ROW_DIVIDER_CLASS,
  LIST_TABLE_ROW_SELECTED_CLASS
} from '@/lib/list-table-layout'
import { cn } from '@/lib/utils'
import type { AgentArtifact } from '../../shared/api-types-artifacts'
import { canOpenAgentArtifact, copyAgentArtifact, openAgentArtifact } from './artifact-actions'
import {
  artifactRoles,
  artifactTitle,
  builtBySummary,
  roleDotClass,
  roleLabel
} from './artifact-labels'
import type { ArtifactsListTab } from './artifacts-page-rows'
import { AGENT_ARTIFACTS_GRID } from './agent-artifacts-table'

function IconAction({
  label,
  onClick,
  children
}: {
  label: string
  onClick: () => void
  children: React.ReactNode
}): React.JSX.Element {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="icon-xs"
          className="size-7"
          aria-label={label}
          onClick={(event) => {
            event.stopPropagation()
            onClick()
          }}
          onKeyDown={(event) => event.stopPropagation()}
        >
          {children}
        </Button>
      </TooltipTrigger>
      <TooltipContent side="top" sideOffset={4}>
        {label}
      </TooltipContent>
    </Tooltip>
  )
}

/** Open and copy: a claude.ai link opens in the browser, a vault report from disk. */
export function ArtifactOpenCopy({
  artifact,
  className
}: {
  artifact: AgentArtifact
  className?: string
}): React.JSX.Element {
  const local = artifact.source === 'local'
  return (
    <div className={cn('flex shrink-0 items-center justify-end gap-0.5', className)}>
      {canOpenAgentArtifact(artifact) ? (
        <IconAction
          label={local ? 'Open file' : 'Open in browser'}
          onClick={() => openAgentArtifact(artifact)}
        >
          <ExternalLink className="size-3.5" />
        </IconAction>
      ) : null}
      <IconAction
        label={local ? 'Copy path' : 'Copy link'}
        onClick={() => copyAgentArtifact(artifact)}
      >
        <Copy className="size-3.5" />
      </IconAction>
    </div>
  )
}

export function RoleDots({ roles }: { roles: readonly string[] }): React.JSX.Element {
  return (
    <span className="flex shrink-0 -space-x-0.5" aria-hidden="true">
      {roles.map((role) => (
        <span
          key={role}
          className={cn('size-2 rounded-full ring-[1.5px] ring-background', roleDotClass(role))}
        />
      ))}
    </span>
  )
}

function TicketChips({ tickets }: { tickets: readonly string[] }): React.JSX.Element {
  if (tickets.length === 0) {
    return <span className="text-muted-foreground">—</span>
  }
  const shown = tickets.slice(0, 3)
  return (
    <span className="flex min-w-0 flex-wrap gap-1">
      {shown.map((ticket) => (
        <span key={ticket} className="rounded bg-muted px-1.5 font-mono text-2xs leading-5">
          {ticket}
        </span>
      ))}
      {tickets.length > shown.length ? (
        <span className="rounded bg-muted px-1.5 text-2xs leading-5 text-muted-foreground">
          +{tickets.length - shown.length}
        </span>
      ) : null}
    </span>
  )
}

function NameCell({ title, sub, mono }: { title: string; sub: string; mono?: boolean }) {
  return (
    <span className="min-w-0">
      <span className="block truncate font-medium" title={title}>
        {title}
      </span>
      {sub ? (
        <span
          className={cn('block truncate text-xs text-muted-foreground', mono && 'font-mono')}
          title={sub}
        >
          {sub}
        </span>
      ) : null}
    </span>
  )
}

function Cells({ artifact, tab }: { artifact: AgentArtifact; tab: ArtifactsListTab }) {
  const updated = formatArtifactUpdatedCompact(artifact.last_published)
  const updatedCell = <span className="truncate text-muted-foreground">{updated}</span>
  if (tab === 'local') {
    const job = artifact.job || 'Interactive'
    return (
      <>
        <NameCell title={artifactTitle(artifact)} sub={artifact.id} mono />
        <TicketChips tickets={artifact.tickets} />
        <span className="flex min-w-0 items-center gap-1.5 text-xs text-muted-foreground">
          <RoleDots roles={[artifact.job ? 'job' : 'interactive']} />
          <span className="truncate">{job}</span>
        </span>
        {updatedCell}
      </>
    )
  }
  if (tab === 'untracked') {
    return (
      <>
        <NameCell title={artifactTitle(artifact)} sub={artifact.url} mono />
        {updatedCell}
      </>
    )
  }
  const roles = artifactRoles(artifact)
  return (
    <>
      <NameCell title={artifactTitle(artifact)} sub={artifact.description} />
      <TicketChips tickets={artifact.tickets} />
      <span
        className="flex min-w-0 items-center gap-1.5 text-xs text-muted-foreground"
        title={artifact.contributions.map(roleLabel).join(', ')}
      >
        <RoleDots roles={roles} />
        <span className="truncate">{builtBySummary(artifact)}</span>
      </span>
      <span className="tabular-nums text-muted-foreground">{artifact.versions || '—'}</span>
      {updatedCell}
    </>
  )
}

/**
 * One artifact in the table. From agents opens its details; a vault report and an account-only link open
 * themselves, having nothing more to show.
 */
export function AgentArtifactRow({
  artifact,
  tab,
  selected,
  showDivider,
  onSelect
}: {
  artifact: AgentArtifact
  tab: ArtifactsListTab
  selected: boolean
  showDivider: boolean
  onSelect: (id: string) => void
}): React.JSX.Element {
  const activate = (): void => {
    if (tab === 'agents') {
      onSelect(artifact.id)
    } else if (canOpenAgentArtifact(artifact)) {
      openAgentArtifact(artifact)
    } else {
      copyAgentArtifact(artifact)
    }
  }
  return (
    <div
      role="button"
      tabIndex={0}
      data-current={selected ? 'true' : undefined}
      onClick={activate}
      onKeyDown={(event) => {
        if (isRowActivationKey(event)) {
          event.preventDefault()
          activate()
        }
      }}
      className={cn(
        AGENT_ARTIFACTS_GRID[tab],
        LIST_TABLE_ROW_CLASS,
        showDivider && LIST_TABLE_ROW_DIVIDER_CLASS,
        selected && LIST_TABLE_ROW_SELECTED_CLASS
      )}
    >
      <Cells artifact={artifact} tab={tab} />
      <ArtifactOpenCopy artifact={artifact} />
    </div>
  )
}
