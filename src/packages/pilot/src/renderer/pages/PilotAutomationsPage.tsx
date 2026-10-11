import { lazy, Suspense, useState } from 'react'
import { PilotAutomationsTab } from './PilotAutomationsTab'

export const AUTOMATIONS_TAB_KEY = 'pilot.automations.tab'
type TabId = 'pilot' | 'orca'
// Lazy so Orca's page (and its app-store graph) only loads when the Orca tab is opened.
const OrcaAutomationsPage = lazy(
  () => import('../../../../../renderer/src/components/automations/AutomationsPage')
)
const TABS: { id: TabId; label: string }[] = [
  { id: 'pilot', label: 'Pilot' },
  { id: 'orca', label: 'Orca' }
]

function readTab(): TabId {
  try {
    return window.localStorage.getItem(AUTOMATIONS_TAB_KEY) === 'orca' ? 'orca' : 'pilot'
  } catch {
    return 'pilot'
  }
}

function saveTab(tab: TabId): void {
  try {
    window.localStorage.setItem(AUTOMATIONS_TAB_KEY, tab)
  } catch {
    // Remembering the tab is a convenience only.
  }
}

export default function PilotAutomationsPage(): React.JSX.Element {
  const [tab, setTab] = useState<TabId>(readTab)
  const select = (next: TabId): void => {
    setTab(next)
    saveTab(next)
  }
  return (
    <div className="flex h-full min-h-0 flex-col bg-background">
      <div role="tablist" className="flex shrink-0 gap-1 border-b border-border px-5 pt-3">
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            role="tab"
            aria-selected={tab === t.id}
            onClick={() => select(t.id)}
            className={
              tab === t.id
                ? '-mb-px border-b-2 border-foreground px-3 py-1.5 text-sm font-medium text-foreground'
                : '-mb-px border-b-2 border-transparent px-3 py-1.5 text-sm text-muted-foreground hover:text-foreground'
            }
          >
            {t.label}
          </button>
        ))}
      </div>
      {tab === 'orca' ? (
        <>
          <p className="shrink-0 px-5 pt-2 text-xs text-muted-foreground">
            Orca&apos;s own automations, run by Orca&apos;s engine inside Pilot.
          </p>
          <div className="min-h-0 flex-1 overflow-hidden">
            <Suspense fallback={null}>
              <OrcaAutomationsPage />
            </Suspense>
          </div>
        </>
      ) : (
        <div className="min-h-0 flex-1">
          <PilotAutomationsTab />
        </div>
      )}
    </div>
  )
}
