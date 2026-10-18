import { useDeferredValue, useMemo } from 'react'
import type { InboxListRow } from '../../../shared/api-types'
import { groupHostedItems, type HostedSection } from '../../hosts/hosted-sections'
import { groupHostedItemsBy } from '../../hosts/inbox-grouping'
import type { MergedInbox } from '../../hosts/merge-inbox'
import { hostedKey, type Hosted } from '../../hosts/pilot-host'
import { ALL } from './InboxHeader'
import { type CardFilters, type InboxTab, inTab, matchesFilters } from './inbox-tabs'
import type { InboxGroupBy, InboxSort } from './inbox-view-prefs'

export type InboxSections = {
  // The search the cards are filtered by: it trails the search box while a keystroke renders.
  query: string
  filtered: boolean
  // Each card's Worktree heading by hostedKey: what search matches, and what a list row names under another grouping.
  places: ReadonlyMap<string, string>
  inTabItems: Hosted<InboxListRow>[]
  shownItems: Hosted<InboxListRow>[]
  sections: HostedSection[]
  // The picked section, or All once it has no card left (its last one was answered, or the tab moved).
  activeSection: string
  shown: HostedSection[]
}

/**
 * The tab's cards through the chips and the search, grouped, and the picked section's. The search is deferred and
 * the result kept until an input changes, so a keystroke renders the search box without re-rendering a card.
 */
export function useInboxSections({
  inbox,
  tab,
  filters,
  group,
  sort,
  section,
  now
}: {
  inbox: MergedInbox | null
  tab: InboxTab
  filters: CardFilters
  group: InboxGroupBy
  sort: InboxSort
  section: string
  now: number
}): InboxSections {
  const query = useDeferredValue(filters.query)
  const { kinds } = filters
  return useMemo(() => {
    const items = inbox?.items ?? []
    const automations = inbox?.automations ?? []
    const openItems = items.filter((i) => i.type !== 'default')
    const places = new Map(
      groupHostedItems(openItems, automations).flatMap((s) =>
        s.items.map((i) => [hostedKey(i.host, i.id), s.group.label] as const)
      )
    )
    const inTabItems =
      tab === 'done'
        ? []
        : openItems.filter((i) =>
            inTab(i, tab, inbox?.answerStates.get(hostedKey(i.host, i.id)) ?? null)
          )
    const shownItems = inTabItems.filter((i) =>
      matchesFilters(i, { kinds, query }, places.get(hostedKey(i.host, i.id)) ?? '')
    )
    const sections = groupHostedItemsBy(shownItems, automations, group, sort, now)
    const activeSection = sections.some((s) => s.key === section) ? section : ALL
    return {
      query,
      filtered: kinds.length > 0 || query.trim() !== '',
      places,
      inTabItems,
      shownItems,
      sections,
      activeSection,
      shown: sections.filter((s) => activeSection === ALL || s.key === activeSection)
    }
  }, [inbox, tab, kinds, query, group, sort, section, now])
}
