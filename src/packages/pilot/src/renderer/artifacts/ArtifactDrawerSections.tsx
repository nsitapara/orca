import { useEffect, useState } from 'react'
import { Copy, ExternalLink, Terminal } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { openHttpLink } from '@/lib/http-link-routing'
import { cn } from '@/lib/utils'
import type { AgentArtifact, ArtifactContribution } from '../../shared/api-types-artifacts'
import { useLinearIssue } from '../activity-card/linear-branch-issue'
import { canOpenLocalFiles, copyText, openLocalFile } from './artifact-actions'
import {
  baseName,
  isScratchpadPath,
  publishDates,
  resumeCommand,
  roleLabel,
  roleTagClass
} from './artifact-labels'
import { ticketTree, useTicketParents } from './ticket-tree'

function LinkButton({
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
          className="size-6 shrink-0"
          aria-label={label}
          onClick={onClick}
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

function Section({
  title,
  empty,
  children
}: {
  title: string
  empty: string
  children: React.ReactNode[]
}): React.JSX.Element {
  return (
    <section className="flex flex-col gap-1.5">
      <h3 className="text-2xs font-semibold uppercase tracking-[0.05em] text-muted-foreground">
        {title}
      </h3>
      <ul className="flex flex-col rounded-md border border-border/60">
        {children.length > 0 ? (
          children
        ) : (
          <li className="px-2.5 py-2 text-xs text-muted-foreground">{empty}</li>
        )}
      </ul>
    </section>
  )
}

function Item({ sub, children }: { sub?: boolean; children: React.ReactNode }) {
  return (
    <li
      className={cn(
        'flex min-w-0 items-start gap-2 border-b border-border/60 px-2.5 py-2 last:border-b-0',
        sub && 'pl-6'
      )}
    >
      {children}
    </li>
  )
}

function TicketItem({ ticket, sub, note }: { ticket: string; sub?: boolean; note?: string }) {
  const issue = useLinearIssue(ticket)
  const url = issue?.url
  return (
    <Item sub={sub}>
      <span className="min-w-0 flex-1">
        {url ? (
          <button
            type="button"
            className="font-mono text-xs text-foreground underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
            onClick={(event) => openHttpLink(url, { modifierHeld: event.shiftKey })}
          >
            {sub ? `↳ ${ticket}` : ticket}
          </button>
        ) : (
          <span className="font-mono text-xs">{sub ? `↳ ${ticket}` : ticket}</span>
        )}
        {issue?.title ? (
          <span className="block truncate text-xs text-muted-foreground">{issue.title}</span>
        ) : null}
        {note ? <span className="block text-xs text-muted-foreground">{note}</span> : null}
      </span>
    </Item>
  )
}

export function TicketsSection({ tickets }: { tickets: readonly string[] }): React.JSX.Element {
  const parentOf = useTicketParents()
  const items = ticketTree(tickets, parentOf).flatMap((node) => [
    <TicketItem
      key={node.ticket}
      ticket={node.ticket}
      note={
        node.children.length > 0
          ? `Parent ticket · ${node.children.length} sub-issue${node.children.length === 1 ? '' : 's'} worked on this artifact`
          : undefined
      }
    />,
    ...node.children.map((child) => <TicketItem key={child} ticket={child} sub />)
  ])
  return (
    <Section title="Tickets" empty="No ticket on any branch that published it">
      {items}
    </Section>
  )
}

function PathItem({
  name,
  path,
  note,
  open
}: {
  name: string
  path: string
  note?: string
  open: string | null
}) {
  return (
    <Item>
      <span className="min-w-0 flex-1">
        <span className="block break-words text-xs [overflow-wrap:anywhere]">{name}</span>
        <span className="block break-words font-mono text-2xs text-muted-foreground [overflow-wrap:anywhere]">
          {path}
        </span>
        {note ? <span className="block text-2xs text-muted-foreground">{note}</span> : null}
      </span>
      {open ? (
        <LinkButton label="Open file" onClick={() => openLocalFile(open)}>
          <ExternalLink className="size-3.5" />
        </LinkButton>
      ) : null}
      <LinkButton label="Copy path" onClick={() => void copyText(open ?? path, 'Path copied')}>
        <Copy className="size-3.5" />
      </LinkButton>
    </Item>
  )
}

export function VaultNotesSection({
  notes,
  vaultRoot
}: {
  notes: readonly string[]
  vaultRoot: string | null
}): React.JSX.Element {
  const openable = vaultRoot && canOpenLocalFiles()
  return (
    <Section title="Notes in your vault" empty="No vault note links to it yet">
      {notes.map((note) => (
        <PathItem
          key={note}
          name={baseName(note).replace(/\.md$/i, '')}
          path={note}
          open={openable ? `${vaultRoot}/${note}` : null}
        />
      ))}
    </Section>
  )
}

// Which source files are still on disk: checked for the open drawer only. Null until known (or unknowable).
function usePathsExist(paths: readonly string[]): readonly boolean[] | null {
  const [exist, setExist] = useState<{ key: string; value: readonly boolean[] } | null>(null)
  const key = paths.join('\n')
  useEffect(() => {
    let alive = true
    const check = window.api?.shell?.pathsExist
    if (!check || paths.length === 0 || !canOpenLocalFiles()) {
      return
    }
    void check([...paths]).then(
      (value) => alive && setExist({ key, value }),
      () => undefined
    )
    return () => {
      alive = false
    }
    // oxlint-disable-next-line react-hooks/exhaustive-deps -- key stands for paths.
  }, [key])
  return exist?.key === key ? exist.value : null
}

function sourceNote(path: string, exists: boolean | undefined): string | undefined {
  if (exists === false) {
    return isScratchpadPath(path) ? 'Gone: its session has ended' : 'Gone from disk'
  }
  return isScratchpadPath(path) ? 'Session scratchpad: gone once the session ends' : undefined
}

export function SourceFilesSection({ files }: { files: readonly string[] }): React.JSX.Element {
  const exist = usePathsExist(files)
  return (
    <Section title="Source files" empty="Not recorded">
      {files.map((file, i) => (
        <PathItem
          key={file}
          name={baseName(file)}
          path={file}
          note={sourceNote(file, exist?.[i])}
          open={exist?.[i] === true ? file : null}
        />
      ))}
    </Section>
  )
}

function SessionItem({ contribution }: { contribution: ArtifactContribution }) {
  const c = contribution
  const worktree = c.worktree ? baseName(c.worktree) : 'No worktree'
  const branch = c.branch && c.branch !== worktree ? ` · ${c.branch}` : ''
  const resume = resumeCommand(c.session_id)
  return (
    <Item>
      <span
        className={cn(
          'shrink-0 whitespace-nowrap rounded px-1.5 text-2xs font-medium leading-5',
          roleTagClass(c.role)
        )}
      >
        {roleLabel(c)}
      </span>
      <span className="min-w-0 flex-1">
        <span
          className="block break-words font-mono text-xs [overflow-wrap:anywhere]"
          title={c.worktree}
        >
          {worktree}
        </span>
        <span className="block text-2xs text-muted-foreground">
          {c.publishes} publish{c.publishes === 1 ? '' : 'es'} · {publishDates(c.first, c.last)}
          {branch}
        </span>
      </span>
      {resume ? (
        <LinkButton
          label="Copy resume command"
          onClick={() => void copyText(resume, 'Resume command copied')}
        >
          <Terminal className="size-3.5" />
        </LinkButton>
      ) : null}
    </Item>
  )
}

export function BuiltBySection({ artifact }: { artifact: AgentArtifact }): React.JSX.Element {
  const n = artifact.contributions.length
  return (
    <Section
      title={`Who built it · ${n} session${n === 1 ? '' : 's'}`}
      empty="No session recorded publishing it"
    >
      {artifact.contributions.map((c) => (
        <SessionItem key={`${c.session_id}:${c.worktree}`} contribution={c} />
      ))}
    </Section>
  )
}
