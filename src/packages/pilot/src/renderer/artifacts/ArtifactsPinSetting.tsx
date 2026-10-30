import type { ReactNode } from 'react'
import { SettingsSwitchRow } from '@/components/settings/SettingsFormControls'
import { pilotStore } from '../store'
import { setSidebarPagePinned, usePinnedPages } from '../sidebar/sidebar-pages'

/**
 * pilot-hook: artifacts-pin-setting. Settings › Artifacts: Pilot's sidebar has no Artifacts button, so its switch
 * pins the page instead, the same pin as ☰ and Settings › Sidebar. Upstream's switch shows until Pilot attaches.
 */
export function ArtifactsPinSetting({ children }: { children: ReactNode }): ReactNode {
  const pinned = usePinnedPages().includes('artifacts')
  if (!pilotStore()) {
    return children
  }
  return (
    <SettingsSwitchRow
      label="Pin Artifacts"
      description="Show Artifacts as a row at the top of the sidebar. It stays in the sidebar's ☰ menu."
      checked={pinned}
      onChange={() => setSidebarPagePinned('artifacts', !pinned)}
    />
  )
}
