import {
  CalendarClock,
  Files,
  FlaskConical,
  Gauge,
  Inbox,
  List,
  type LucideIcon
} from 'lucide-react'
import { useAppStore } from '@/store'
import {
  pinnedPages,
  withPagePinned,
  type SidebarPageKey
} from '../../shared/sidebar-pages-settings'
import {
  setPilotAutomationsView,
  setPilotOpenAutomation,
  usePilotAutomationsView,
  type PilotAutomationsView
} from '../pages/automations-view'

export const SIDEBAR_PAGES: Record<SidebarPageKey, { label: string; icon: LucideIcon }> = {
  inbox: { label: 'Inbox', icon: Inbox },
  running: { label: 'Running', icon: Gauge },
  automations: { label: 'Automations', icon: CalendarClock },
  tasks: { label: 'Tasks', icon: List },
  artifacts: { label: 'Artifacts', icon: Files },
  playground: { label: 'Playground', icon: FlaskConical }
}

// Inbox, Running and Playground are views of the Automations page, each with its own row.
const AUTOMATIONS_PAGE_VIEWS: readonly SidebarPageKey[] = ['inbox', 'running', 'playground']

/** The page the center column shows, or null for a workspace or a page with no row. */
export function openSidebarPage(
  activeView: string | undefined,
  automationsView: PilotAutomationsView
): SidebarPageKey | null {
  if (activeView === 'automations') {
    return AUTOMATIONS_PAGE_VIEWS.find((page) => page === automationsView) ?? 'automations'
  }
  if (activeView === 'tasks' || activeView === 'artifacts') {
    return activeView
  }
  return null
}

export function useOpenSidebarPage(): SidebarPageKey | null {
  const activeView = useAppStore((s) => s.activeView)
  return openSidebarPage(activeView, usePilotAutomationsView())
}

export function usePinnedPages(): SidebarPageKey[] {
  const saved = useAppStore((s) => s.settings?.pilotPinnedPages)
  return pinnedPages(saved)
}

export function setSidebarPagePinned(page: SidebarPageKey, pin: boolean): void {
  const { settings, updateSettings } = useAppStore.getState()
  void updateSettings({
    pilotPinnedPages: withPagePinned(pinnedPages(settings?.pilotPinnedPages), page, pin)
  })
}

// Automations always lands on its list: an automation that was open closes, even from Automations itself.
export function showSidebarPage(page: SidebarPageKey): void {
  const store = useAppStore.getState()
  switch (page) {
    case 'tasks':
      store.openTaskPage()
      return
    case 'artifacts':
      store.openArtifactsPage()
      return
    case 'automations':
      setPilotAutomationsView('automations')
      setPilotOpenAutomation(null)
      store.openAutomationsPage()
      return
    case 'inbox':
    case 'running':
    case 'playground':
      setPilotAutomationsView(page)
      store.openAutomationsPage()
  }
}
