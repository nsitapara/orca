// The pages the sidebar's ☰ menu opens, in the order their rows show.
export const SIDEBAR_PAGE_KEYS = [
  'inbox',
  'running',
  'automations',
  'tasks',
  'artifacts',
  'playground'
] as const
export type SidebarPageKey = (typeof SIDEBAR_PAGE_KEYS)[number]

// Composed into upstream's GlobalSettingsBase (pilot-hook: sidebar-pages-settings).
export type SidebarPagesSettings = {
  /** The pages pinned as sidebar rows. Absent means DEFAULT_PINNED_PAGES. */
  pilotPinnedPages?: SidebarPageKey[]
}

export const DEFAULT_PINNED_PAGES: readonly SidebarPageKey[] = ['inbox', 'running', 'automations']

/** The saved pins in page order, unknown keys (a newer build's) dropped; the defaults when unset. */
export function pinnedPages(saved: unknown): SidebarPageKey[] {
  const list: readonly unknown[] = Array.isArray(saved) ? saved : DEFAULT_PINNED_PAGES
  return SIDEBAR_PAGE_KEYS.filter((key) => list.includes(key))
}

export function withPagePinned(
  pinned: readonly SidebarPageKey[],
  page: SidebarPageKey,
  pin: boolean
): SidebarPageKey[] {
  return SIDEBAR_PAGE_KEYS.filter((key) => (key === page ? pin : pinned.includes(key)))
}

/** The sidebar's page rows: the pinned ones, and the open page while it's open. */
export function sidebarNavPages(
  pinned: readonly SidebarPageKey[],
  openPage: SidebarPageKey | null
): SidebarPageKey[] {
  return SIDEBAR_PAGE_KEYS.filter((key) => pinned.includes(key) || key === openPage)
}
