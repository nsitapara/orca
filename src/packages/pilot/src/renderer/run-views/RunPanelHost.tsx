import { useEffect } from 'react'
import { hostedKey } from '../hosts/pilot-host'
import { PilotHostProvider } from '../hosts/PilotHostContext'
import { RunPanel } from './RunPanel'
import { closeRunPanel, useOpenRun } from './run-panel-state'

// The one run panel (spec §5), over whichever Automations view is open; closing it leaves that view as it was, scrolled
// where it was. Everything in it asks the run's own machine.
export function RunPanelHost(): React.JSX.Element | null {
  const open = useOpenRun()
  useEffect(() => {
    if (!open) {
      return
    }
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        closeRunPanel()
      }
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [open])
  if (!open) {
    return null
  }
  return (
    <aside
      aria-label="Run"
      className="absolute inset-y-0 right-0 z-30 w-[min(36rem,100%)] overflow-y-auto border-l border-border bg-background shadow-xl"
    >
      <PilotHostProvider host={open.host}>
        {/* Keyed by machine too: another machine's run with the same id never shows this one's. */}
        <RunPanel
          key={hostedKey(open.host, open.runId)}
          runId={open.runId}
          part={open.part}
          onClose={closeRunPanel}
        />
      </PilotHostProvider>
    </aside>
  )
}
