import { useEffect, useState } from 'react'
import { ExternalLink, RotateCw, Settings2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { pilotdOrigin, type PilotdHealth } from '../../shared/automation-engine-settings'
import {
  clearPendingInboxCard,
  usePendingInboxCard,
  usePilotAutomationsView,
  usePilotOpenAutomation
} from '../pages/automations-view'
import {
  openAutomationEngineSetting,
  pilotdHash,
  usePilotdAddress,
  usePilotdHealth
} from './pilotd-engine'

const HEALTH_POLL_MS = 10_000

function Header({
  origin,
  health,
  onReload,
  url
}: {
  origin: string
  health: PilotdHealth | null
  onReload: () => void
  url: string
}): React.JSX.Element {
  const stopped = health?.reachable === true && !health.engineRunning
  return (
    <header className="flex shrink-0 items-center gap-2 border-b border-border px-3 py-1.5 text-xs">
      <span className="min-w-0 truncate font-medium" title={origin}>
        {`pilotd · ${origin}`}
      </span>
      {stopped ? (
        <span className="shrink-0 text-status-warning">
          pilotd&apos;s engine isn&apos;t running, so no job starts.
        </span>
      ) : null}
      <div className="ml-auto flex shrink-0 items-center gap-1">
        <Button type="button" variant="ghost" size="xs" onClick={onReload}>
          <RotateCw className="size-3.5" />
          Reload
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="xs"
          onClick={() => window.open(url, '_blank', 'noopener,noreferrer')}
        >
          <ExternalLink className="size-3.5" />
          Open in browser
        </Button>
        <Button type="button" variant="ghost" size="xs" onClick={openAutomationEngineSetting}>
          <Settings2 className="size-3.5" />
          Engine setting
        </Button>
      </div>
    </header>
  )
}

/** Shown in place of the frame when pilotd doesn't answer, so a wrong setting is never a blank page. */
export function PilotdUnreachable({
  address,
  error,
  onRetry
}: {
  address: string
  error: string
  onRetry: () => void
}): React.JSX.Element {
  return (
    <div className="flex h-full items-center justify-center bg-background p-6">
      <div
        role="alert"
        className="flex max-w-md flex-col gap-3 rounded-md border border-border p-5 text-sm"
      >
        <h2 className="text-sm font-semibold">pilotd isn&apos;t reachable</h2>
        <p className="text-muted-foreground">{error}</p>
        <p className="text-xs text-muted-foreground">
          Address: <span className="font-mono text-foreground">{address}</span>
        </p>
        <p className="text-xs text-muted-foreground">
          Pilot is set to show pilotd&apos;s dashboard here. Start pilotd (pilotd serve), fix the
          address, or switch back to the built-in engine in Settings › Automations.
        </p>
        <div className="flex flex-wrap gap-2">
          <Button type="button" size="sm" onClick={onRetry}>
            Retry
          </Button>
          <Button type="button" size="sm" variant="outline" onClick={openAutomationEngineSetting}>
            Switch to the built-in engine
          </Button>
        </div>
      </div>
    </div>
  )
}

// pilotd's dashboard in place of Pilot's Automations pages. The frame keeps its own sign-in (its origin's storage in
// the window's persistent session); Pilot never sees pilotd's token. Pilot's view and open automation pick the
// dashboard's deep link; a hash-only change navigates the page without reloading it.
export function PilotdDashboard(): React.JSX.Element {
  const address = usePilotdAddress()
  const origin = pilotdOrigin(address)
  const view = usePilotAutomationsView()
  const automationId = usePilotOpenAutomation()
  const pendingCard = usePendingInboxCard()
  const { health, refresh } = usePilotdHealth(address, HEALTH_POLL_MS, origin !== null)
  const [frameKey, setFrameKey] = useState(0)

  // Card ids from Pilot's own store mean nothing to pilotd: drop the pick so it never lingers.
  useEffect(() => {
    if (pendingCard !== null) {
      clearPendingInboxCard()
    }
  }, [pendingCard])

  if (origin === null) {
    return (
      <PilotdUnreachable
        address={address}
        error="The pilotd address isn't a web address. Use one like http://127.0.0.1:8787."
        onRetry={refresh}
      />
    )
  }
  if (health === null) {
    return <p className="p-5 text-sm text-muted-foreground">{`Checking pilotd at ${origin}…`}</p>
  }
  if (!health.reachable) {
    return <PilotdUnreachable address={origin} error={health.error} onRetry={refresh} />
  }
  const url = `${origin}/${pilotdHash(view, { automationId }) ?? '#overview'}`
  return (
    <div className="flex h-full flex-col bg-background">
      <Header
        origin={origin}
        health={health}
        url={url}
        onReload={() => {
          setFrameKey((n) => n + 1)
          refresh()
        }}
      />
      <iframe
        key={frameKey}
        title="pilotd dashboard"
        src={url}
        // Its own origin, scripts, forms and popups (they open in the system browser); never the app window.
        sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-popups-to-escape-sandbox allow-downloads"
        allow="clipboard-write"
        className="min-h-0 w-full flex-1 border-0"
      />
    </div>
  )
}
