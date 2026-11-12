import { showSidebarPage } from '../sidebar/sidebar-pages'
import { useAutomationEngine } from './pilotd-engine'

/** With pilotd chosen, a surface still fed by Pilot's own engine says so in one line. */
export function BuiltInEngineNote(): React.JSX.Element | null {
  if (useAutomationEngine() !== 'pilotd') {
    return null
  }
  return (
    <p className="rounded bg-muted px-2 py-1 text-xs text-muted-foreground">
      {"Showing the built-in engine's data; pilotd runs the jobs. "}
      <button type="button" className="underline" onClick={() => showSidebarPage('automations')}>
        Open Automations for pilotd
      </button>
    </p>
  )
}
