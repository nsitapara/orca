import { useRef } from 'react'
import { ChevronDown } from 'lucide-react'
import { formatArtifactUpdatedCompact } from '@/components/artifacts/artifact-display-labels'
import { isRowActivationKey } from '@/lib/list-row-interaction'
import { cn } from '@/lib/utils'
import { useAppStore } from '@/store'
import type { AgentArtifact } from '../../shared/api-types-artifacts'
import { useBranchLinearIssue } from '../activity-card/linear-branch-issue'
import { pilotStore } from '../store'
import { artifactTitle, ticketSummary } from './artifact-labels'
import { ArtifactOpenCopy } from './AgentArtifactRow'
import { useArtifactsFeed, useWorktreeArtifacts } from './artifacts-feed'
import { FoldResizeHandle } from './FoldResizeHandle'
import { useFoldResize } from './fold-resize'
import {
  setArtifactsFoldOpen,
  showArtifact,
  showArtifactsForWorktree,
  useArtifactsFoldOpen
} from './artifacts-view'

/** "WEB-1982 +1 · 3 days ago · v52": a fold-out row's second line. */
export function foldRowMeta(artifact: AgentArtifact, age: string): string {
  const ticket = ticketSummary(artifact.tickets)
  return [ticket, age, `v${artifact.versions}`].filter(Boolean).join(' · ')
}

function FoldRow({ artifact }: { artifact: AgentArtifact }): React.JSX.Element {
  const title = artifactTitle(artifact)
  const open = (): void => showArtifact(artifact.id, 'agents')
  return (
    <li className="group/fold-row flex min-w-0 items-center gap-1 rounded-md px-1.5 py-1 hover:bg-worktree-sidebar-foreground/8">
      <div
        role="button"
        tabIndex={0}
        onClick={open}
        onKeyDown={(event) => {
          if (isRowActivationKey(event)) {
            event.preventDefault()
            open()
          }
        }}
        title={artifact.description || title}
        className="min-w-0 flex-1 cursor-pointer rounded-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-worktree-sidebar-ring"
      >
        <span className="block truncate text-xs font-medium text-worktree-sidebar-foreground">
          {title}
        </span>
        <span className="block truncate text-2xs text-muted-foreground">
          {foldRowMeta(artifact, formatArtifactUpdatedCompact(artifact.last_published))}
        </span>
      </div>
      <ArtifactOpenCopy
        artifact={artifact}
        className="opacity-0 transition-opacity group-hover/fold-row:opacity-100 group-focus-within/fold-row:opacity-100"
      />
    </li>
  )
}

function useSelectedWorktree() {
  return useAppStore((s) =>
    s.activeWorktreeId
      ? (s.getKnownWorktreeById(
          s.activeWorktreeId,
          s.activeWorkspaceExecutionHostId ?? undefined
        ) ?? null)
      : null
  )
}

function AttachedFoldOut(): React.JSX.Element | null {
  const worktree = useSelectedWorktree()
  const artifacts = useWorktreeArtifacts(worktree)
  const feed = useArtifactsFeed()
  const ticket = useBranchLinearIssue(worktree?.branch)?.identifier ?? null
  const open = useArtifactsFoldOpen()
  const section = useRef<HTMLElement>(null)
  const resize = useFoldResize(section)
  if (!worktree) {
    return null
  }
  const label = ticket ?? worktree.displayName
  const listId = `pilot-artifacts-fold-${worktree.id}`
  // Folded, it is only its header; the dragged height applies while open.
  const height = open ? resize.height : null
  return (
    <section
      ref={section}
      aria-label="Artifacts"
      style={height === null ? undefined : { height }}
      className={cn(
        'relative mx-2 flex min-h-0 shrink-0 flex-col border-t border-worktree-sidebar-border/60',
        height === null ? 'max-h-[40vh]' : 'max-h-[70%]'
      )}
    >
      {open ? <FoldResizeHandle resize={resize} /> : null}
      <button
        type="button"
        aria-expanded={open}
        aria-controls={listId}
        onClick={() => setArtifactsFoldOpen(!open)}
        className="flex min-w-0 items-center gap-1.5 rounded-md px-1.5 py-2 text-left focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-worktree-sidebar-ring"
      >
        <ChevronDown
          className={cn(
            'size-3.5 shrink-0 text-muted-foreground transition-transform motion-reduce:transition-none',
            !open && '-rotate-90'
          )}
        />
        <span className="shrink-0 text-2xs font-semibold uppercase tracking-[0.05em] text-muted-foreground">
          Artifacts
        </span>
        <span
          className="min-w-0 truncate text-xs font-medium text-worktree-sidebar-foreground"
          title={label}
        >
          {label}
        </span>
        <span className="ml-auto shrink-0 text-2xs tabular-nums text-muted-foreground">
          {artifacts.length}
        </span>
      </button>
      {open ? (
        <div
          id={listId}
          className={cn(
            'scrollbar-sleek min-h-0 overflow-y-auto pb-2',
            height !== null && 'flex-1'
          )}
        >
          {artifacts.length > 0 ? (
            <>
              <ul className="flex flex-col gap-px">
                {artifacts.map((artifact) => (
                  <FoldRow key={artifact.id} artifact={artifact} />
                ))}
              </ul>
              <button
                type="button"
                onClick={() =>
                  showArtifactsForWorktree({ path: worktree.path, label: worktree.displayName })
                }
                className="mt-0.5 rounded-md px-1.5 py-1 text-left text-xs text-worktree-sidebar-foreground/70 hover:text-worktree-sidebar-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-worktree-sidebar-ring"
              >
                Show all in Artifacts →
              </button>
            </>
          ) : (
            <p className="px-1.5 pb-1 text-xs text-muted-foreground">
              {feed.error && feed.artifacts.length === 0
                ? `Artifacts unavailable: ${feed.error}`
                : 'No artifacts from this worktree yet.'}
            </p>
          )}
        </div>
      ) : null}
    </section>
  )
}

// pilot-hook: sidebar-artifacts-fold. The selected worktree's artifacts at the sidebar's foot, above its toolbar.
// Nothing until Pilot attaches.
export function ArtifactsFoldOut(): React.JSX.Element | null {
  return pilotStore() ? <AttachedFoldOut /> : null
}
