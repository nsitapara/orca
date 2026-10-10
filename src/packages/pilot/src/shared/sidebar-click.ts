export const PILOT_TAB = 'plugin:pilot'

export type ActivityClick = { tab: string; effectiveTab: string; open: boolean }

// D22: clicking the active tab closes the panel and keeps the strip; any click on a closed panel opens it.
export function resolveActivityClick({
  tab,
  effectiveTab,
  open
}: ActivityClick): 'close' | 'open' | 'select' {
  if (!open) {
    return 'open'
  }
  if (tab === effectiveTab) {
    return 'close'
  }
  return 'select'
}

export function isPilotTab(tab: unknown): boolean {
  return tab === PILOT_TAB
}
