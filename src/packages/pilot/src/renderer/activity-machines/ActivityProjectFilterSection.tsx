import React from 'react'
import {
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger
} from '@/components/ui/dropdown-menu'
import { translate } from '@/i18n/i18n'
import SidebarRepositoryFilterSection from '@/components/sidebar/SidebarRepositoryFilterSection'
import { SidebarProjectFilterPanel } from '@/components/sidebar/SidebarProjectFilterPanel'
import type { Repo } from '../../../../../shared/repo-types'
import { useActivityProjectChoices } from './use-activity-project-scope'

type ActivityProjectFilterSectionProps = {
  filterRepoIds: readonly string[]
  setFilterRepoIds: (ids: string[]) => void
}

function projectsLabel(): string {
  return translate('auto.components.sidebar.SidebarRepositoryFilterSection.7679f0c268', 'Projects')
}

function valueLabel(selected: readonly Repo[]): string {
  if (selected.length === 0) {
    return translate(
      'auto.components.sidebar.SidebarRepositoryFilterSection.allProjects',
      'All projects'
    )
  }
  if (selected.length === 1) {
    return selected[0].displayName
  }
  return translate(
    'auto.components.sidebar.SidebarRepositoryFilterSection.selectedProjectsCount',
    '{{value0}} projects',
    { value0: selected.length }
  )
}

/** Activity's Projects picker; lists a project once however many machines hold a copy. */
export function ActivityProjectFilterSection({
  filterRepoIds,
  setFilterRepoIds
}: ActivityProjectFilterSectionProps): React.JSX.Element | null {
  const result = useActivityProjectChoices(filterRepoIds)
  if (!result) {
    return (
      <SidebarRepositoryFilterSection
        filterRepoIds={filterRepoIds}
        setFilterRepoIds={setFilterRepoIds}
      />
    )
  }
  const { choices, selected } = result
  if (choices.length < 2) {
    return null
  }
  const selectedIds = new Set(selected.map((repo) => repo.id))
  const available = choices.filter((repo) => !selectedIds.has(repo.id))
  const hasFilter = selected.length > 0

  return (
    <DropdownMenuSub>
      <DropdownMenuSubTrigger>
        <span className="flex flex-1 items-center justify-between gap-3">
          <span>{projectsLabel()}</span>
          <span className="min-w-0 truncate text-[11px] font-medium text-muted-foreground">
            {valueLabel(selected)}
          </span>
        </span>
      </DropdownMenuSubTrigger>
      <DropdownMenuSubContent className="w-64">
        <div className="flex items-center justify-between px-2 py-1">
          <span className="text-[11px] font-semibold text-muted-foreground">
            {projectsLabel()}
            {hasFilter && (
              <span className="ml-1.5 font-medium text-foreground">· {selected.length}</span>
            )}
          </span>
          <button
            type="button"
            onClick={() => setFilterRepoIds([])}
            className="rounded-full px-2 py-0.5 text-[11px] font-medium text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:opacity-40 disabled:hover:bg-transparent"
            disabled={!hasFilter}
          >
            {translate(
              'auto.components.sidebar.SidebarRepositoryFilterSection.d3a9c4cea1',
              'Clear'
            )}
          </button>
        </div>
        <SidebarProjectFilterPanel
          availableRepos={available}
          selectedRepos={selected}
          hasRepoFilter={hasFilter}
          filterRepoIds={selected.map((repo) => repo.id)}
          setFilterRepoIds={setFilterRepoIds}
        />
      </DropdownMenuSubContent>
    </DropdownMenuSub>
  )
}
