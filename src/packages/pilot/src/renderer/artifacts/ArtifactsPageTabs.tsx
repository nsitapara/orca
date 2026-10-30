import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { pilotStore } from '../store'
import { useArtifactsFeed } from './artifacts-feed'
import { tabCounts } from './artifacts-page-rows'
import {
  shownArtifactsTab,
  updateArtifactsView,
  useArtifactsView,
  type ArtifactsTab
} from './artifacts-view'

const TABS: readonly { tab: ArtifactsTab; label: string }[] = [
  { tab: 'agents', label: 'From agents' },
  { tab: 'local', label: 'Local reports' },
  { tab: 'untracked', label: 'Not tracked' },
  { tab: 'shared', label: 'Shared from Orca' }
]

function isArtifactsTab(value: string): value is ArtifactsTab {
  return TABS.some((t) => t.tab === value)
}

function AttachedTabs({ signedIn }: { signedIn: boolean }): React.JSX.Element {
  const { artifacts } = useArtifactsFeed()
  const view = useArtifactsView()
  const counts = tabCounts(artifacts)
  const shown = shownArtifactsTab(view.tab, signedIn)
  return (
    <Tabs
      value={shown}
      onValueChange={(value) => {
        if (isArtifactsTab(value)) {
          updateArtifactsView({ tab: value, selected: null })
        }
      }}
      className="ml-4 min-w-0"
    >
      <TabsList aria-label="Artifacts">
        {TABS.filter((t) => t.tab !== 'shared' || signedIn).map((t) => (
          <TabsTrigger key={t.tab} value={t.tab}>
            {t.label}
            {t.tab === 'shared' ? null : (
              <span className="tabular-nums text-muted-foreground">{counts[t.tab]}</span>
            )}
          </TabsTrigger>
        ))}
      </TabsList>
    </Tabs>
  )
}

// pilot-hook: artifacts-page-tabs. The Artifacts page's tabs, beside its title. Nothing until Pilot attaches.
export function ArtifactsPageTabs({ signedIn }: { signedIn: boolean }): React.JSX.Element | null {
  return pilotStore() ? <AttachedTabs signedIn={signedIn} /> : null
}
