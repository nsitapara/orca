import { useCallback, useRef, useState } from 'react'
import { isWebClientLocation } from '@/lib/web-client-location'
import { CommandsHere } from './CommandsTab'
import { TelemetryPanel } from './telemetry/TelemetryPanel'

type PlaygroundTab = 'telemetry' | 'commands'
const TABS: { id: PlaygroundTab; label: string }[] = [
  { id: 'telemetry', label: 'Telemetry' },
  { id: 'commands', label: 'Commands' }
]

const SUBTITLE =
  'pilotcli on this Mac: which commands get called and how they fail, and each command with a Try-it panel.'
// The browser's Commands tab has no Try-it panel: the playground's page is a loopback address on Pilot's machine.
const WEB_SUBTITLE =
  'pilotcli on the Mac Pilot runs on: which commands get called and how they fail.'
const ELSEWHERE_TEXT =
  'The playground runs only on the machine Pilot runs on. Start it in Pilot there.'

function PlaygroundHeader({ subtitle }: { subtitle: string }): React.JSX.Element {
  return (
    <div>
      <h2 className="text-sm font-semibold leading-6">Playground</h2>
      <p className="text-xs text-muted-foreground">{subtitle}</p>
    </div>
  )
}

function tabClass(selected: boolean): string {
  return selected ? 'border-b-2 border-foreground pb-1' : 'pb-1 text-muted-foreground'
}

function PlaygroundTabs({
  tab,
  onPick
}: {
  tab: PlaygroundTab
  onPick: (tab: PlaygroundTab) => void
}): React.JSX.Element {
  return (
    <div
      role="tablist"
      aria-label="Playground"
      className="flex gap-4 border-b border-border/50 text-sm"
    >
      {TABS.map((t) => (
        <button
          key={t.id}
          type="button"
          role="tab"
          aria-selected={tab === t.id}
          className={tabClass(tab === t.id)}
          onClick={() => onPick(t.id)}
        >
          {t.label}
        </button>
      ))}
    </div>
  )
}

// Two tabs: Telemetry (pilotcli's calls on this Mac) and Commands (pilotcli's playground). Both stay mounted, so a
// switch never stops or reloads a running playground.
export function PlaygroundPage(): React.JSX.Element {
  const web = isWebClientLocation()
  const [tab, setTab] = useState<PlaygroundTab>('telemetry')
  const picked = useRef(false)
  // A playground already running opens on Commands, unless Nish has picked a tab.
  const onRunning = useCallback(() => {
    if (!picked.current) {
      setTab('commands')
    }
  }, [])
  const pick = (next: PlaygroundTab): void => {
    picked.current = true
    setTab(next)
  }
  return (
    <section className="flex h-full flex-col gap-3 px-5 pb-4 pt-4">
      <PlaygroundHeader subtitle={web ? WEB_SUBTITLE : SUBTITLE} />
      <PlaygroundTabs tab={tab} onPick={pick} />
      <div
        role="tabpanel"
        aria-label="Telemetry"
        hidden={tab !== 'telemetry'}
        className="min-h-0 flex-1 overflow-y-auto scrollbar-sleek"
      >
        <TelemetryPanel active={tab === 'telemetry'} />
      </div>
      <div
        role="tabpanel"
        aria-label="Commands"
        hidden={tab !== 'commands'}
        className="flex min-h-0 flex-1 flex-col gap-3"
      >
        {web ? (
          <p className="text-xs text-muted-foreground">{ELSEWHERE_TEXT}</p>
        ) : (
          <CommandsHere onRunning={onRunning} />
        )}
      </div>
    </section>
  )
}
