import { useState } from 'react'
import type { InboxItemRow, InboxListRow } from '../../../shared/api-types'
import type { PreparationWait } from '../../../shared/inbox-types'
import { hostRpc } from '../../hosts/host-rpc'
import { usePilotHost } from '../../hosts/PilotHostContext'
import { errorText } from '../format'
import { PREPARATION_NEED_LABELS } from './preparation-needs'

// The request a job saved for its card, as readable text: pretty JSON when it is JSON.
function requestText(context: string): string {
  try {
    return JSON.stringify(JSON.parse(context), null, 2)
  } catch {
    return context
  }
}

// The list carries a light ref (Ruling 2); the full request is read only when asked (pilot.inbox.get).
function RequestView({ id }: { id: string }): React.JSX.Element {
  // The card's own machine holds its request.
  const host = usePilotHost()
  const [open, setOpen] = useState(false)
  const [text, setText] = useState<string | null>(null)
  const toggle = async (): Promise<void> => {
    setOpen(!open)
    if (open || text !== null) {
      return
    }
    try {
      const item = await hostRpc<InboxItemRow>(host, 'pilot.inbox.get', { id })
      setText(requestText(item.preparation?.input.context ?? ''))
    } catch (e) {
      setText(errorText(e))
    }
  }
  return (
    <div className="grid gap-1">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => void toggle()}
        className="w-fit text-xs text-[var(--ib-accent)] hover:underline"
      >
        {open ? 'Hide the request' : 'Show the request'}
      </button>
      {open ? (
        <pre className="max-h-64 overflow-auto whitespace-pre-wrap text-xs">
          {text ?? 'Loading…'}
        </pre>
      ) : null}
    </div>
  )
}

// R-P5: a push or drafted card that was never prepared (imported, or from an older build) runs nothing until a
// person queues it for job 14.
function NeedsEvidence({
  onPrepare
}: {
  onPrepare: () => Promise<string | null>
}): React.JSX.Element {
  const [error, setError] = useState<string | null>(null)
  return (
    <div role="status" className="flex flex-col gap-1 text-sm text-muted-foreground">
      <p>
        Needs evidence: this was never prepared, so nothing runs from it until job 14 prepares and
        verifies it.
      </p>
      <button
        type="button"
        onClick={() => void onPrepare().then(setError)}
        className="w-fit rounded border px-2 py-0.5 text-xs text-foreground hover:bg-muted"
      >
        Prepare evidence
      </button>
      {error ? <p className="text-destructive">{error}</p> : null}
    </div>
  )
}

export function PreparationProgress({
  item,
  onRetry,
  onPrepareEvidence,
  wait = null
}: {
  item: InboxListRow
  // Why a queued card is still in the runner's line (InboxListPayload.preparationWaits); null from an older Pilot.
  wait?: PreparationWait | null
  // A person's Retry on a blocked card (pilot.inbox.prepareRetry): null once requeued, else why not.
  onRetry: () => Promise<string | null>
  // A person's Prepare evidence on a never-prepared card (pilot.inbox.prepareEvidence): null once queued.
  onPrepareEvidence: () => Promise<string | null>
}): React.JSX.Element | null {
  const [retryError, setRetryError] = useState<string | null>(null)
  const preparation = item.preparation
  if (item.needsEvidence) {
    return <NeedsEvidence onPrepare={onPrepareEvidence} />
  }
  if (!preparation) {
    return null
  }
  if (preparation.state === 'cancelled') {
    return (
      <p className="text-xs text-muted-foreground">
        Context preparation stopped after your answer.
      </p>
    )
  }
  if (preparation.state === 'ready') {
    return null
  }
  const retry = async (): Promise<void> => {
    setRetryError(await onRetry())
  }
  return (
    <div role="status" className="flex flex-col gap-1 text-sm text-muted-foreground">
      {preparation.progress ? <p>{preparation.progress}</p> : null}
      {preparation.state === 'queued' && wait ? <p>Waiting: {wait.detail}</p> : null}
      <p>
        Needed for your decision:{' '}
        {preparation.input.requirements.map((kind) => PREPARATION_NEED_LABELS[kind]).join(', ')}.
      </p>
      {preparation.error ? <p className="text-destructive">{preparation.error}</p> : null}
      {preparation.state === 'blocked' ? (
        <button
          type="button"
          onClick={() => void retry()}
          className="w-fit rounded border px-2 py-0.5 text-xs text-foreground hover:bg-muted"
        >
          Retry preparation
        </button>
      ) : null}
      {retryError ? <p className="text-destructive">{retryError}</p> : null}
      <RequestView id={item.id} />
      <p>
        You can answer now to stop preparation. Generated changes can be approved once their context
        is ready.
      </p>
    </div>
  )
}
