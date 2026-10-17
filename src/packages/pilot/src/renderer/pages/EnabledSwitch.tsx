import { useState } from 'react'
import { SwitchIndicator } from '@/components/ui/switch'
import { hostRpc } from '../hosts/host-rpc'
import type { PilotHostRef } from '../hosts/pilot-host'
import { errorText } from './format'

// A row to switch, with the machine whose YAML it is.
export type ToggleRow = { id: string; host: PilotHostRef }
export type Toggle = (rows: readonly ToggleRow[], enabled: boolean) => Promise<void>

// Each automation through the one-automation call on its own machine, one at a time, so Pilot applies its caller rules
// (an agent in a run is refused). Each is tried; nothing is rolled back. Returns the refusals as "<id>: <why>".
export async function setEnabledAll(
  rows: readonly ToggleRow[],
  enabled: boolean
): Promise<string[]> {
  const refused: string[] = []
  for (const { id, host } of rows) {
    try {
      await hostRpc(host, 'pilot.automations.setEnabled', { id, enabled })
    } catch (e) {
      refused.push(`${id}: ${errorText(e)}`)
    }
  }
  return refused
}

// The list's Status cell: flips the automation (or a job's stages) on or off in its YAML. A click here doesn't open
// the row. While the call runs it shows the state asked for. With a refusal it stays put and says why on hover.
export function EnabledSwitch({
  name,
  on,
  text,
  refusal = null,
  onToggle
}: {
  name: string
  on: boolean
  text: string
  refusal?: string | null
  onToggle: () => Promise<void>
}): React.JSX.Element {
  const [busy, setBusy] = useState(false)
  const shown = busy ? !on : on
  const flip = async (): Promise<void> => {
    setBusy(true)
    try {
      await onToggle()
    } finally {
      setBusy(false)
    }
  }
  // The wrapper also catches a click on the disabled switch, which would otherwise reach the row.
  return (
    <span onClick={(e) => e.stopPropagation()}>
      <button
        type="button"
        role="switch"
        aria-checked={shown}
        aria-label={`${name}: ${on ? 'turn off' : 'turn on'}`}
        title={refusal ?? undefined}
        disabled={busy || refusal !== null}
        onClick={() => void flip()}
        className="flex items-center gap-2 text-xs text-muted-foreground hover:text-foreground disabled:opacity-50"
      >
        <SwitchIndicator checked={shown} size="compact" />
        {text}
      </button>
    </span>
  )
}
