import { useState } from 'react'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog'
import type { RunRow, StopRunResult } from '../../shared/api-types'
import { hostRpc } from '../hosts/host-rpc'
import type { PilotHostRef } from '../hosts/pilot-host'
import { usePilotHost } from '../hosts/PilotHostContext'
import { errorText } from '../pages/format'

// The desktop or a paired device may stop a run (methods-runs.ts): the browser version offers it too.
export function canStop(run: Pick<RunRow, 'status'>): boolean {
  return run.status === 'running'
}

export type StopControl = {
  // The Stop button and its confirmation; null once the run isn't running.
  control: React.JSX.Element | null
  // What Pilot said: stopped, or why it couldn't (an older Pilot's missing method included).
  note: string | null
}

// Why: an answer run has no Continue run or Retry; stopping it reopens its cards (answer-run-end.ts).
function stopDialogText(answerRun: boolean): string {
  if (answerRun) {
    return "Its agent's tab closes, and the cards it was answering go back to your Inbox."
  }
  return "Its agent's tab closes. You can pick it up again from Recently finished."
}

// Stop, for a view that places Pilot's answer itself: the agent's tab closes and the run ends cancelled, only after a
// yes. The run's machine is `host`, else the surrounding view's.
export function useStopRun(
  run: Pick<RunRow, 'id' | 'status'>,
  host?: PilotHostRef,
  answerRun = false
): StopControl {
  const viewHost = usePilotHost()
  const on = host ?? viewHost
  const [asking, setAsking] = useState(false)
  const [busy, setBusy] = useState(false)
  const [note, setNote] = useState<string | null>(null)
  if (!canStop(run)) {
    return { control: null, note }
  }
  const stop = async (): Promise<void> => {
    setAsking(false)
    if (busy) {
      return
    }
    setBusy(true)
    try {
      const result = await hostRpc<StopRunResult>(on, 'pilot.runs.stop', { runId: run.id })
      setNote(result.stopped ? 'Stopped' : result.reason)
    } catch (e) {
      setNote(errorText(e))
    } finally {
      setBusy(false)
    }
  }
  const control = (
    <>
      <button
        type="button"
        disabled={busy}
        className="shrink-0 underline"
        onClick={() => setAsking(true)}
      >
        {busy ? 'Stopping…' : 'Stop'}
      </button>
      <Dialog open={asking} onOpenChange={setAsking}>
        <DialogContent className="max-w-sm" showCloseButton={false}>
          <DialogHeader>
            <DialogTitle>Stop this run?</DialogTitle>
            <DialogDescription>{stopDialogText(answerRun)}</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            {/* Why: Enter on the open dialog must not stop the run. */}
            <Button
              type="button"
              variant="ghost"
              size="sm"
              autoFocus
              onClick={() => setAsking(false)}
            >
              Cancel
            </Button>
            <Button type="button" variant="destructive" size="sm" onClick={() => void stop()}>
              Stop run
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
  return { control, note }
}

// Stop with Pilot's answer beside it, as Continue run shows its own (ContinueRun.tsx).
export function StopRun({
  run,
  host,
  answerRun = false
}: {
  run: Pick<RunRow, 'id' | 'status'>
  host?: PilotHostRef
  answerRun?: boolean
}): React.JSX.Element | null {
  const { control, note } = useStopRun(run, host, answerRun)
  if (!control && note === null) {
    return null
  }
  return (
    <span className="flex min-w-0 flex-wrap items-center gap-2">
      {control}
      {note ? <span className="min-w-0 text-muted-foreground">{note}</span> : null}
    </span>
  )
}
