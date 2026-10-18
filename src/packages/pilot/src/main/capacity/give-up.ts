import type { RunRow } from '../../shared/api-types'
import type { AutomationDefinition } from '../../shared/definition/types'
import { plural } from '../../shared/tick/checks'
import { addInboxItem } from '../inbox/inbox-add'
import type { InboxDeps } from '../inbox/inbox-service'

// A run's end counted a failure on its key, which has failed `failures` times in a row now.
export type FailureCounted = (run: RunRow, failures: number) => void

type FailedRun = Pick<RunRow, 'itemKey' | 'itemLabel' | 'outcome'>

// The failure that first passes the retry limit leaves one flagged card. An ask-first job never retries on its own.
export function leaveGiveUpCard(
  inbox: InboxDeps,
  def: AutomationDefinition,
  run: FailedRun,
  failures: number
): void {
  if (def.start === 'ask_first' || failures !== inbox.store.capacity.retryLimit() + 1) {
    return
  }
  addInboxItem(inbox, {
    type: 'flagged',
    automationId: def.id,
    itemKey: run.itemKey,
    title: `${def.name} failed ${plural(failures, 'time')}: ${run.itemLabel}`,
    context: `${run.outcome ?? 'It ended without an outcome'}\n\nRetry it from Running.`
  })
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

// The run engine's hook: a card that can't be written is logged, never thrown into the run's end.
export function giveUpOnFailure(
  inbox: InboxDeps,
  definitionFor: (automationId: string) => AutomationDefinition | null,
  log: (message: string) => void
): FailureCounted {
  return (run, failures) => {
    const def = definitionFor(run.automationId)
    if (!def) {
      return
    }
    try {
      leaveGiveUpCard(inbox, def, run, failures)
    } catch (error) {
      log(`[pilot] run ${run.id}: couldn't leave the give-up card: ${messageOf(error)}`)
    }
  }
}
