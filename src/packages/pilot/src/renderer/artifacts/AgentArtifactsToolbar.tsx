import { X } from 'lucide-react'
import { clampArtifactListSearchQuery } from '@/components/artifacts/artifact-list-search'
import { ArtifactListToolbar } from '@/components/artifacts/ArtifactListToolbar'
import { Button } from '@/components/ui/button'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@/components/ui/select'
import type { ArtifactsListTab } from './artifacts-page-rows'
import { loadArtifacts } from './artifacts-feed'
import { updateArtifactsView, type ArtifactsView } from './artifacts-view'

const ALL_REPOS = '__all__'

function RepoFilter({ repos, repo }: { repos: readonly string[]; repo: string }) {
  return (
    <Select
      value={repo || ALL_REPOS}
      onValueChange={(value) => updateArtifactsView({ repo: value === ALL_REPOS ? '' : value })}
    >
      <SelectTrigger size="sm" aria-label="Repository">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value={ALL_REPOS}>All repos</SelectItem>
        {repos.map((name) => (
          <SelectItem key={name} value={name}>
            {name}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}

function WorktreeFilter({ label }: { label: string }) {
  return (
    <span className="inline-flex h-8 min-w-0 items-center gap-1 rounded-md border border-border bg-muted/40 pl-2.5 text-xs">
      <span className="text-muted-foreground">Worktree</span>
      <span className="max-w-[16rem] truncate font-medium" title={label}>
        {label}
      </span>
      <Button
        type="button"
        variant="ghost"
        size="icon-xs"
        aria-label="Show every worktree"
        onClick={() => updateArtifactsView({ worktree: null })}
      >
        <X className="size-3.5" />
      </Button>
    </span>
  )
}

/** Upstream's search and Refresh, then on From agents the repo filter and the worktree the page was opened on. */
export function AgentArtifactsToolbar({
  tab,
  view,
  repos,
  loading
}: {
  tab: ArtifactsListTab
  view: ArtifactsView
  repos: readonly string[]
  loading: boolean
}): React.JSX.Element {
  return (
    <div className="flex shrink-0 flex-wrap items-center gap-2">
      <ArtifactListToolbar
        query={view.query}
        onQueryChange={(query) =>
          updateArtifactsView({ query: clampArtifactListSearchQuery(query) })
        }
        onRefresh={() => loadArtifacts(true)}
        isRefreshing={loading}
      />
      {tab === 'agents' && repos.length > 1 ? <RepoFilter repos={repos} repo={view.repo} /> : null}
      {tab === 'agents' && view.worktree ? <WorktreeFilter label={view.worktree.label} /> : null}
    </div>
  )
}
