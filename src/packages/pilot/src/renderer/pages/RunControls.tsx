import { useEffect, useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@/components/ui/select'
import type { TickOutcome } from '../../shared/api-types'
import { hostRpc } from '../hosts/host-rpc'
import type { PilotHostRef } from '../hosts/pilot-host'
import {
  runNowBlocked,
  runNowPick,
  type RunNowChoice,
  type RunNowChoices
} from '../hosts/run-now-hosts'
import { errorText, outcomeLine } from './format'

export const LONG_CALL_MS = 180_000
type Phase = 'idle' | 'confirm' | 'running'
type Method = 'pilot.automations.dryRun' | 'pilot.automations.tickNow'

// Dry run is safe; Run now starts real agents, so it takes an explicit inline Confirm. Both go to the automation's
// home machine, or Run now to the one picked from `choices`. A dry run's answer goes to onDryRun for the page to show
// (it is stored nowhere); a real tick's outcome is the line under the buttons.
export function RunControls({
  id,
  host,
  choices,
  onDone,
  onDryRun
}: {
  id: string
  host: PilotHostRef
  choices?: RunNowChoices
  onDone: () => void
  onDryRun: (outcome: TickOutcome) => void
}): React.JSX.Element {
  const [phase, setPhase] = useState<Phase>('idle')
  const [message, setMessage] = useState<string | null>(null)
  const [chosen, setChosen] = useState<string | null>(null)
  const inFlight = useRef(false)
  const mounted = useRef(true)
  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
    }
  }, [])
  const picked = choices ? runNowPick(choices, chosen) : null

  const run = async (method: Method, target: PilotHostRef): Promise<void> => {
    if (inFlight.current) {
      return
    }
    inFlight.current = true
    setPhase('running')
    setMessage(null)
    // With several machines, a tick's line says which one answered.
    const line = (text: string): string =>
      choices && method === 'pilot.automations.tickNow' ? `On ${target.machineName}: ${text}` : text
    try {
      const result = await hostRpc<TickOutcome>(target, method, { id }, { timeoutMs: LONG_CALL_MS })
      if (mounted.current && method === 'pilot.automations.dryRun') {
        onDryRun(result)
      } else if (mounted.current) {
        setMessage(line(outcomeLine(result, id)))
      }
    } catch (e) {
      if (mounted.current) {
        setMessage(line(errorText(e)))
      }
    }
    inFlight.current = false
    if (!mounted.current) {
      return
    }
    setPhase('idle')
    // A dry run changed nothing to reload.
    if (method === 'pilot.automations.tickNow') {
      onDone()
    }
  }

  const bar =
    phase === 'confirm' ? (
      <RunConfirmBar
        choices={choices}
        picked={picked}
        onPick={setChosen}
        onConfirm={() => void run('pilot.automations.tickNow', picked?.host ?? host)}
        onCancel={() => setPhase('idle')}
      />
    ) : (
      <RunButtons
        busy={phase === 'running'}
        onDryRun={() => void run('pilot.automations.dryRun', host)}
        onRunNow={() => setPhase('confirm')}
      />
    )
  return (
    <div className="flex flex-col items-end gap-1">
      <div className="flex items-center gap-2">{bar}</div>
      {message ? <p className="text-sm text-muted-foreground">{message}</p> : null}
    </div>
  )
}

function MachineSelect({
  choices,
  value,
  onPick
}: {
  choices: readonly RunNowChoice[]
  value: string
  onPick: (key: string) => void
}): React.JSX.Element {
  return (
    <Select value={value} onValueChange={onPick}>
      <SelectTrigger size="sm" aria-label="Machine">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {choices.map((c) => (
          <SelectItem key={c.host.key} value={c.host.key} disabled={c.disabled !== null}>
            {c.disabled ? `${c.label} · ${c.disabled}` : c.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}

// The picker shows only when there is more than one machine to start it on.
function machineAsk(
  choices: RunNowChoices | undefined,
  picked: RunNowChoice | null
): { options: readonly RunNowChoice[]; picked: RunNowChoice } | null {
  return choices && picked && choices.choices.length > 1
    ? { options: choices.choices, picked }
    : null
}

function RunConfirmBar({
  choices,
  picked,
  onPick,
  onConfirm,
  onCancel
}: {
  choices: RunNowChoices | undefined
  picked: RunNowChoice | null
  onPick: (key: string) => void
  onConfirm: () => void
  onCancel: () => void
}): React.JSX.Element {
  const cancel = (
    <Button variant="ghost" size="sm" onClick={onCancel}>
      Cancel
    </Button>
  )
  // No machine can start it: say why, and offer nothing to confirm.
  const blocked = choices ? runNowBlocked(choices) : null
  if (blocked) {
    return (
      <>
        <span className="text-sm text-destructive">{blocked}</span>
        {cancel}
      </>
    )
  }
  const ask = machineAsk(choices, picked)
  return (
    <>
      {ask ? (
        <MachineSelect choices={ask.options} value={ask.picked.host.key} onPick={onPick} />
      ) : null}
      <span className="text-sm">
        {ask
          ? `Start agents on ${ask.picked.label} for items that pass the checks?`
          : 'Start agents for items that pass the checks?'}
      </span>
      <Button size="sm" onClick={onConfirm}>
        Confirm
      </Button>
      {cancel}
    </>
  )
}

function RunButtons({
  busy,
  onDryRun,
  onRunNow
}: {
  busy: boolean
  onDryRun: () => void
  onRunNow: () => void
}): React.JSX.Element {
  return (
    <>
      {busy ? <span className="text-sm text-muted-foreground">Running…</span> : null}
      <Button variant="outline" size="sm" disabled={busy} onClick={onDryRun}>
        Dry run
      </Button>
      <Button variant="secondary" size="sm" disabled={busy} onClick={onRunNow}>
        Run now
      </Button>
    </>
  )
}
