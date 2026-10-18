import type { TickResult } from '../../shared/api-types'
import type { AutomationDefinition } from '../../shared/definition/types'
import type { PeopleDirectory } from '../../shared/people'
import { handoverOf } from '../handover/tick-handover'
import { createPassFetchCache } from '../sources/fetch-cache'
import { messageOf } from '../sources/gitlab-fetch'
import { glabApiForRepo } from '../sources/gitlab-api'
import { decideTickItems, type DecideOutcome, type DecideScope } from './tick-decide'
import type { TickDeps, TickOptions } from './tick-runner'

// A dry run has no tick row: it decides with run.tick 0, which no stored tick has, as a new tick's id would be.
const DRY_RUN_TICK = 0

// A tick's decisions: a real tick's under its row's id, a dry run's under DRY_RUN_TICK.
export async function decide(
  def: AutomationDefinition,
  people: PeopleDirectory,
  deps: TickDeps,
  opts: TickOptions & Pick<DecideScope, 'lineKeys'>,
  tickId: number
): Promise<DecideOutcome> {
  const label = tickId === DRY_RUN_TICK ? `dry-run-${def.id}` : `tick-${tickId}`
  const pass = opts.pass ?? createPassFetchCache(label, deps.gitlab ?? glabApiForRepo)
  return decideTickItems(def, people, deps, pass, tickId, opts)
}

// What a tick would do, stored nowhere: no tick row, no seen or handled marks, no runs, no cards, no handover.
// The caller shows the decisions it returns (tickId null).
export async function dryRunTick(
  def: AutomationDefinition,
  people: PeopleDirectory,
  deps: TickDeps,
  opts: TickOptions
): Promise<TickResult> {
  let outcome: DecideOutcome
  try {
    outcome = await decide(def, people, deps, opts, DRY_RUN_TICK)
  } catch (error) {
    return {
      tickId: null,
      status: 'failed',
      error: messageOf(error),
      decisions: [],
      warnings: []
    }
  }
  const { decisions, warnings } = outcome
  for (const warning of warnings) {
    console.warn(`[pilot] ${def.id} (dry run): ${warning}`)
  }
  try {
    await deps.previewEnvs?.(def, decisions)
  } catch (error) {
    return { tickId: null, status: 'failed', error: messageOf(error), decisions, warnings }
  }
  const handover = handoverOf(def, outcome.fed, decisions)
  return {
    tickId: null,
    status: 'ok',
    error: null,
    decisions,
    warnings,
    ...(handover ? { handover } : {})
  }
}
