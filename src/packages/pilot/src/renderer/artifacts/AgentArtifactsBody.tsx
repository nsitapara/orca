import { useMemo, useState, type ReactNode } from 'react'
import { ArtifactsPageSkeleton } from '@/components/artifacts/ArtifactsPageSkeleton'
import { ArtifactsPageErrorBanner } from '@/components/artifacts/ArtifactsPageStates'
import { VirtualizedList } from '@/components/virtualized-list'
import { LIST_TABLE_CONTAINER_CLASS, LIST_TABLE_HEADER_CLASS } from '@/lib/list-table-layout'
import { cn } from '@/lib/utils'
import { pilotStore } from '../store'
import { vaultRootOf } from './artifact-actions'
import { AgentArtifactDrawer } from './AgentArtifactDrawer'
import { AgentArtifactRow } from './AgentArtifactRow'
import { AgentArtifactsToolbar } from './AgentArtifactsToolbar'
import {
  AGENT_ARTIFACTS_GRID,
  AGENT_ARTIFACTS_HEADERS,
  AGENT_ARTIFACTS_ROW_HEIGHT_PX
} from './agent-artifacts-table'
import { loadArtifacts, useArtifactsFeed } from './artifacts-feed'
import { filterArtifacts, repoOptions, type ArtifactsListTab } from './artifacts-page-rows'
import { shownArtifactsTab, updateArtifactsView, useArtifactsView } from './artifacts-view'
import { useKnownRepoPaths } from './use-known-repos'

const TAB_NOTES: Record<ArtifactsListTab, string | null> = {
  agents: null,
  local:
    'HTML reports agents and Pilot jobs wrote into your vault. They open from disk and have no claude.ai link.',
  untracked:
    'On your Claude account, but no agent session is recorded publishing them: claude.ai chats, Codex, or publishes the index missed.'
}

const EMPTY_TEXT: Record<ArtifactsListTab, string> = {
  agents: 'No artifact from an agent yet.',
  local: 'No HTML report in your vault yet.',
  untracked: 'Every artifact on your account has a recorded publish.'
}

function TableHeader({ tab }: { tab: ArtifactsListTab }): React.JSX.Element {
  return (
    <div className={cn(AGENT_ARTIFACTS_GRID[tab], LIST_TABLE_HEADER_CLASS)}>
      {AGENT_ARTIFACTS_HEADERS[tab].map((label) => (
        <span key={label}>{label}</span>
      ))}
      <span className="sr-only">Actions</span>
    </div>
  )
}

function AgentArtifactsList({ tab }: { tab: ArtifactsListTab }): React.JSX.Element {
  const feed = useArtifactsFeed()
  const view = useArtifactsView()
  const known = useKnownRepoPaths()
  const rows = useMemo(
    () => filterArtifacts(feed.artifacts, { ...view, tab }, known),
    [feed.artifacts, view, tab, known]
  )
  const repos = useMemo(() => repoOptions(feed.artifacts, known), [feed.artifacts, known])
  const vaultRoot = useMemo(() => vaultRootOf(feed.artifacts), [feed.artifacts])
  const selected =
    tab === 'agents' ? (feed.artifacts.find((a) => a.id === view.selected) ?? null) : null
  const [scrollElement, setScrollElement] = useState<HTMLDivElement | null>(null)
  const lastId = rows.at(-1)?.id
  const filtered = view.query.trim() !== '' || (tab === 'agents' && (view.repo || view.worktree))
  const note = TAB_NOTES[tab]

  let body: ReactNode
  if (feed.fetchedAt === null && feed.loading) {
    body = <ArtifactsPageSkeleton />
  } else if (rows.length === 0) {
    body = (
      <p className="px-3 py-10 text-center text-sm text-muted-foreground">
        {filtered ? 'No artifact matches these filters.' : EMPTY_TEXT[tab]}
      </p>
    )
  } else {
    body = (
      <div
        ref={setScrollElement}
        className={cn('scrollbar-sleek min-h-0 flex-1 overflow-auto', LIST_TABLE_CONTAINER_CLASS)}
      >
        <TableHeader tab={tab} />
        <VirtualizedList
          rows={rows}
          scrollElement={scrollElement}
          estimateRowHeightPx={AGENT_ARTIFACTS_ROW_HEIGHT_PX}
          announceListPosition
          getRowKey={(artifact) => artifact.id}
          renderRow={(artifact) => (
            <AgentArtifactRow
              key={artifact.id}
              artifact={artifact}
              tab={tab}
              selected={artifact.id === view.selected}
              showDivider={artifact.id !== lastId}
              onSelect={(id) => updateArtifactsView({ selected: id })}
            />
          )}
        />
      </div>
    )
  }

  return (
    <>
      {feed.error ? (
        <ArtifactsPageErrorBanner
          error={feed.error}
          loading={feed.loading}
          onRetry={() => loadArtifacts(true)}
        />
      ) : null}
      <section className="flex min-h-0 flex-1 flex-col gap-3 overflow-hidden px-3 pt-px pb-4 md:px-5">
        <AgentArtifactsToolbar tab={tab} view={view} repos={repos} loading={feed.loading} />
        {note ? <p className="shrink-0 text-xs text-muted-foreground">{note}</p> : null}
        {body}
      </section>
      <AgentArtifactDrawer
        artifact={selected}
        vaultRoot={vaultRoot}
        onClose={() => updateArtifactsView({ selected: null })}
      />
    </>
  )
}

function AttachedBody({ signedIn, children }: { signedIn: boolean; children: ReactNode }) {
  const { tab } = useArtifactsView()
  const shown = shownArtifactsTab(tab, signedIn)
  return shown === 'shared' ? children : <AgentArtifactsList tab={shown} />
}

// pilot-hook: artifacts-page-body. The Artifacts page's body: the tab picked from pilotcli's artifacts index, needing
// no Orca sign-in; upstream's own body (Orca's shared links, its sign-in prompt) on Shared from Orca and until Pilot
// attaches.
export function AgentArtifactsBody({
  signedIn,
  children
}: {
  signedIn: boolean
  children: ReactNode
}): ReactNode {
  return pilotStore() ? <AttachedBody signedIn={signedIn}>{children}</AttachedBody> : children
}
