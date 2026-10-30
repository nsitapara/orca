import type { ReactNode } from 'react'
import { SearchableSetting } from '@/components/settings/SearchableSetting'
import { SettingsSwitchRow } from '@/components/settings/SettingsFormControls'
import { SIDEBAR_PAGE_KEYS } from '../../shared/sidebar-pages-settings'
import { pilotStore } from '../store'
import { setSidebarPagePinned, SIDEBAR_PAGES, usePinnedPages } from './sidebar-pages'

/**
 * pilot-hook: settings-pinned-pages. Settings › Appearance › Sidebar: one switch per page, the same pins as
 * the sidebar's ☰ menu. They stand in for upstream's Tasks, Automations and Orca Mobile buttons, which
 * Pilot's sidebar doesn't show; while Pilot isn't attached, upstream's rows show.
 */
export function PinnedPagesSettings({ children }: { children: ReactNode }): ReactNode {
  const pinned = usePinnedPages()
  if (!pilotStore()) {
    return children
  }
  return SIDEBAR_PAGE_KEYS.map((page) => {
    const { label } = SIDEBAR_PAGES[page]
    const title = `Pin ${label}`
    const description = `Show ${label} as a row at the top of the sidebar. Every page stays in its ☰ menu.`
    return (
      <SearchableSetting
        key={page}
        title={title}
        description={description}
        keywords={['pinned pages', 'pin', 'sidebar', 'menu', label.toLowerCase()]}
      >
        <SettingsSwitchRow
          label={title}
          description={description}
          checked={pinned.includes(page)}
          onChange={() => setSidebarPagePinned(page, !pinned.includes(page))}
        />
      </SearchableSetting>
    )
  })
}
