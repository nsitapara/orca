import { useState } from 'react'
import type { RunTab } from '../../shared/api-types-capacity'
import { activateRunTab } from '../activity-tabs/activate-run-tab'
import { usePilotHost } from '../hosts/PilotHostContext'

export type ShowTabControl = {
  // The Show tab button; null where there is no tab to show, or the run is on another machine.
  control: React.JSX.Element | null
  // Why nothing opened, once it didn't.
  note: string | null
}

// Show tab: opens the run's agent tab in this window. Another machine's tab can't be activated from here.
export function useShowTab(tab: RunTab | undefined): ShowTabControl {
  const { local } = usePilotHost()
  const [note, setNote] = useState<string | null>(null)
  if (!tab || !local) {
    return { control: null, note: null }
  }
  const control = (
    <button
      type="button"
      className="shrink-0 underline"
      onClick={() => setNote(activateRunTab(tab) ? null : 'Its tab is closed')}
    >
      Show tab
    </button>
  )
  return { control, note }
}
