import type { PreparationFor } from '../../shared/api-types'
import { usePilotHost } from '../hosts/PilotHostContext'
import { PREPARATION_NEED_LABELS } from '../pages/waiting/preparation-needs'
import { openRun } from './run-panel-state'
import { RunFact } from './RunFact'

// "2 of 3 · the last try ended: …": which try this is, and why the one before it ended.
function tryText(p: PreparationFor): string {
  const which = p.maxAttempts === null ? `${p.attempt}` : `${p.attempt} of ${p.maxAttempts}`
  return p.lastError ? `${which} · the last try ended: ${p.lastError}` : which
}

// A context-preparation run's summary rows: what it gathers for which card, the job and run that asked for it, and
// which try this is. Open card leaves the panel for the Inbox; the asking run opens in the panel.
export function PreparationFacts({
  preparation: p,
  onOpenCard
}: {
  preparation: PreparationFor
  onOpenCard: (cardId: string) => void
}): React.JSX.Element {
  const host = usePilotHost()
  const needs = p.needs.map((need) => PREPARATION_NEED_LABELS[need]).join(', ') || 'context'
  const askedIn = p.askedInRun
  return (
    <>
      <RunFact name="Preparing">
        {p.cardTitle === null ? (
          `${needs} for a card no longer in the Inbox`
        ) : (
          <>
            {`${needs} for the card above · `}
            <button type="button" className="underline" onClick={() => onOpenCard(p.cardId)}>
              Open card
            </button>
          </>
        )}
      </RunFact>
      {p.askedBy ? (
        <RunFact name="Asked by">
          {p.askedBy}
          {askedIn ? (
            <>
              {' in '}
              <button
                type="button"
                className="underline"
                onClick={() => openRun(askedIn, null, host)}
              >
                {`run ${askedIn}`}
              </button>
            </>
          ) : null}
        </RunFact>
      ) : null}
      <RunFact name="Try">{tryText(p)}</RunFact>
    </>
  )
}
