import { useEffect, useRef } from 'react'
import type { InboxListRow } from '../../../shared/api-types'
import { hostedKey, type Hosted } from '../../hosts/pilot-host'
import { clearPendingInboxCard, usePendingInboxCard } from '../automations-view'
import { ALL } from './InboxHeader'
import type { InboxTab } from './inbox-tabs'
import type { InboxView, InboxViewPrefs } from './inbox-view-prefs'

type PendingCardPage = {
  // Every card listed so far; null before the first read.
  items: readonly Hosted<InboxListRow>[] | null
  // A machine's list hasn't answered yet: another machine's card can arrive in a later read than this machine's.
  loading: boolean
  // The cards on screen, by hostedKey, whatever the view.
  visibleKeys: ReadonlySet<string>
  tab: InboxTab
  filtered: boolean
  section: string
  view: InboxView
  setPrefs: (patch: Partial<InboxViewPrefs>) => void
  // Clears the chips, the search and the picked section.
  unfilter: () => void
  // Selects the card and scrolls to it.
  pick: (key: string) => void
}

/**
 * A card the run panel's "asks you" link named (a hostedKey): shown in Cards, picked and scrolled to once the
 * list has it, then forgotten. Returns what picking another card calls, so a card still loading is then dropped.
 */
export function usePendingInboxCardPick(page: PendingCardPage): () => void {
  const pending = usePendingInboxCard()
  // The pending card the person picked another card over while it loaded.
  const pickedOver = useRef<string | null>(null)
  const { items, loading, visibleKeys, tab, filtered, section, view, setPrefs, unfilter, pick } =
    page
  useEffect(() => {
    if (!pending || !items) {
      return
    }
    const found = items.find((i) => hostedKey(i.host, i.id) === pending)
    if (!found && loading) {
      return
    }
    const picked = pickedOver.current === pending
    if (found && !picked) {
      const home = found.type === 'default' ? 'done' : 'all'
      // Hidden by the tab, a filter or the picked section: show it unfiltered, and pick it on the next render.
      if (!visibleKeys.has(pending) && (tab !== home || filtered || section !== ALL)) {
        setPrefs({ tab: home })
        unfilter()
        return
      }
      // Rows and One at a time have no card to scroll to: switch to Cards, as Rows' Open does.
      if (view !== 'cards' && tab !== 'done') {
        setPrefs({ view: 'cards' })
        return
      }
    }
    pickedOver.current = null
    clearPendingInboxCard()
    if (found && !picked) {
      pick(pending)
    }
  }, [pending, items, loading, visibleKeys, tab, filtered, section, view, setPrefs, unfilter, pick])
  return () => {
    pickedOver.current = pending
  }
}
