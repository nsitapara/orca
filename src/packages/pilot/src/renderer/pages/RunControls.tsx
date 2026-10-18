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
import type { MergedAutomation } from '../hosts/merge-automations'
import type { PilotHostRef } from '../hosts/pilot-host'
import {
  runNowAway,
  runNowHeld,
  runNowPick,
  type RunNowChoice,
  type RunNowChoices
} from '../hosts/run-now-hosts'
import { errorText, outcomeLine } from './format'

export const LONG_CALL_MS = 180_000
type Phase = 'idle' | 'confirm' | 'running'
type Method = 'pilot.automations.dryRun' | 'pilot.automations.tickNow'

// Run now starts real agents, so it takes an inline Confirm (Dry run doesn't) and goes to the machine `choices` picks.
export function RunControls({
  id,
  host,
  choices,
  row,
  onDone,
  onDryRun
}: {
  id: string
  host: PilotHostRef
  choices?: RunNowChoices
  row?: Pick<MergedAutomation, 'name' | 'runsOn'> | null
  onDone: () => void
  onDryRun: (outcome: TickOutcome) => void
}): React.JSX.Element {
  const [phase, setPhase] = useState<Phase>('idle')
  const [message, setMessage] = useState<string | null>(null)
  // Set when the bar opens; after that only the person moves it, and closing the bar clears it.
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
  const away = phase === 'confirm' ? runNowAway(row, choices, picked) : null

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
      setChosen(null)
      onDone()
    }
  }

  const bar =
    phase === 'confirm' ? (
      <RunConfirmBar
        choices={choices}
        chosen={chosen}
        picked={picked}
        onPick={setChosen}
        onConfirm={() => void run('pilot.automations.tickNow', picked?.host ?? host)}
        onCancel={() => {
          setChosen(null)
          setPhase('idle')
        }}
      />
    ) : (
      <RunButtons
        busy={phase === 'running'}
        onDryRun={() => void run('pilot.automations.dryRun', host)}
        onRunNow={() => {
          setChosen(choices?.preferred ?? null)
          setPhase('confirm')
        }}
      />
    )
  return (
    <div className="flex flex-col items-end gap-1">
      <div className="flex items-center gap-2">{bar}</div>
      {away ? <p className="text-xs text-muted-foreground">{away}</p> : null}
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
        <SelectValue placeholder="Pick a machine" />
      </SelectTrigger>
      <SelectContent>
        {choices.map((c) => (
          <SelectItem key={c.host.key} value={c.host.key} disabled={c.disabled !== null}>
            {c.short ? `${c.label} · ${c.short}` : c.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}

function RunConfirmBar({
  choices,
  chosen,
  picked,
  onPick,
  onConfirm,
  onCancel
}: {
  choices: RunNowChoices | undefined
  chosen: string | null
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
  const picker =
    choices && choices.choices.length > 1 ? (
      <MachineSelect choices={choices.choices} value={chosen ?? ''} onPick={onPick} />
    ) : null
  // Nothing to start on: say why, and offer nothing to confirm.
  if (choices && !picked) {
    return (
      <>
        {picker}
        <span className="text-sm text-destructive">{runNowHeld(choices, chosen)}</span>
        {cancel}
      </>
    )
  }
  return (
    <>
      {picker}
      <span className="text-sm">
        {picker && picked
          ? `Start agents on ${picked.label} for items that pass the checks?`
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
