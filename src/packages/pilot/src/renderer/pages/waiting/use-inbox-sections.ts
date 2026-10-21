import { useMemo } from 'react'
import type { InboxListRow } from '../../../shared/api-types'
import { groupHostedItems, type HostedSection } from '../../hosts/hosted-sections'
import { groupHostedItemsBy } from '../../hosts/inbox-grouping'
import type { MergedInbox } from '../../hosts/merge-inbox'
import { hostedKey, type Hosted } from '../../hosts/pilot-host'
import { ALL } from './InboxHeader'
import { groupByProject, projectOf, type ProjectSections } from './inbox-projects'
import { type CardFilters, matchesFilters } from './inbox-kinds'
import type { InboxGroupBy, InboxSort } from './inbox-view-prefs'

// The section a card has under Group by Worktree, and that section's project.
export type CardHome = Omit<HostedSection, 'items'> & { project: string | null }

export type InboxSections = {
  filtered: boolean
  // Each card's home by hostedKey: what its card names first under another grouping.
  homes: ReadonlyMap<string, CardHome>
  // Each card's "project / worktree" by hostedKey: what a list row names under another grouping.
  places: ReadonlyMap<string, string>
  // Every card the Inbox lists: defaults have none.
  cards: Hosted<InboxListRow>[]
  shownItems: Hosted<InboxListRow>[]
  sections: HostedSection[]
  // The picked section, or All once it has no card left (its last one was answered).
  activeSection: string
  shown: HostedSection[]
  // Grouped by Worktree: the sections (shown) under their projects, in the same order; null under another grouping.
  projects: ProjectSections[] | null
  shownProjects: ProjectSections[] | null
}

// The cards through the kind chips, grouped, and the picked section's.
export function useInboxSections({
  inbox,
  filters,
  group,
  sort,
  section,
  now
}: {
  inbox: MergedInbox | null
  filters: CardFilters
  group: InboxGroupBy
  sort: InboxSort
  section: string
  now: number
}): InboxSections {
  const { kinds } = filters
  return useMemo(() => {
    const items = inbox?.items ?? []
    const automations = inbox?.automations ?? []
    const cards = items.filter((i) => i.type !== 'default')
    const homes = new Map(
      groupHostedItems(cards, automations).flatMap((s) => {
        const home: CardHome = { key: s.key, host: s.host, group: s.group, project: projectOf(s) }
        return s.items.map((i) => [hostedKey(i.host, i.id), home] as const)
      })
    )
    const places = new Map(
      [...homes].map(([key, h]) => [
        key,
        h.project ? `${h.project} / ${h.group.label}` : h.group.label
      ])
    )
    const shownItems = cards.filter((i) => matchesFilters(i, { kinds }))
    const grouped = groupHostedItemsBy(shownItems, automations, group, sort, now)
    const projects = group === 'worktree' ? groupByProject(grouped) : null
    // A project's worktrees side by side, so the list, the cards and One at a time keep one order.
    const sections = projects ? projects.flatMap((p) => p.sections) : grouped
    const activeSection = sections.some((s) => s.key === section) ? section : ALL
    const isShown = (s: HostedSection) => activeSection === ALL || s.key === activeSection
    return {
      filtered: kinds.length > 0,
      homes,
      places,
      cards,
      shownItems,
      sections,
      activeSection,
      shown: sections.filter(isShown),
      projects,
      shownProjects:
        projects
          ?.map((p) => ({ ...p, sections: p.sections.filter(isShown) }))
          .filter((p) => p.sections.length > 0) ?? null
    }
  }, [inbox, kinds, group, sort, section, now])
}
