import type { Power } from '../../shared/definition/types'

// The catalog's outcomes (act.py's, act.py:34): done 0, failed 1, stale 3, needs_agent 4, not_yet 5.
export type ActionOutcome = 'done' | 'failed' | 'stale' | 'needs_agent' | 'not_yet'
export type ActionResult = {
  outcome: ActionOutcome
  detail: string
  link: string | null
  log: string | null
  // not_yet only: what it waits for lasts until someone acts (an open thread, a failed pipeline).
  onYou: boolean
  // stale only: re-ask the card with the detail instead of closing it (a push pilotcli skipped, spec E).
  keepOpen?: true
  // What a later step needs from the effect (linear_create: identifier, branchName).
  data?: Record<string, string>
}
export type ActionRunOpts = { dryRun: boolean; runId: string | null; inboxItemId?: string | null }
// Who asks for an action: a run's own attempt (its run), or a card's Approve (the card, and the run it belongs to).
export type ActionCaller = { runId: string | null; inboxItemId: string | null }

export type ActionEntry = {
  name: string
  // The power a run needs to do this without asking; null = only ever on a person's approval.
  power: Power | null
  label: string
  usage: string
  // Null when the args fit the entry's schema, else what's wrong ("usage: …"). Checked when a card names
  // the action and again before every attempt: nothing runs on args that don't fit.
  checkArgs(args: Record<string, unknown>): string | null
  describe(args: Record<string, unknown>): Promise<string>
  // check → ready → do; never throws (a crash is a failed result).
  run(args: Record<string, unknown>, opts: ActionRunOpts): Promise<ActionResult>
  // Fixes what the approval digest must bind before the action runs or is asked about (a Linear write id,
  // derived from `key`, the attempt's own key), so a retried write is deduplicated. Idempotent: pinned args
  // come back unchanged. Entries with nothing to pin leave it out.
  pin?(args: Record<string, unknown>, key: string): Record<string, unknown>
  // The exact argv this entry spawns for these args (program first), built by the code run() spawns with,
  // so a card's Run line is what runs. Absent for an entry that runs inside Pilot (its args are what runs).
  command?(args: Record<string, unknown>, caller?: ActionCaller): string[] | null
}

export type ActionCatalog = { entries(): ActionEntry[]; get(name: string): ActionEntry | null }

export function actionDone(
  detail: string,
  link: string | null = null,
  data?: Record<string, string>
): ActionResult {
  return { outcome: 'done', detail, link, log: null, onYou: false, ...(data ? { data } : {}) }
}

export function callerOf(opts: ActionRunOpts): ActionCaller {
  return { runId: opts.runId, inboxItemId: opts.inboxItemId ?? null }
}

export function actionFailed(detail: string): ActionResult {
  return { outcome: 'failed', detail, link: null, log: null, onYou: false }
}

// Entries never throw (a crash is a failed result). One that does still ends with a result, so its
// action_runs row is finished, never left 'running' (which would block its card for ever).
export async function runSafely(
  entry: ActionEntry,
  args: Record<string, unknown>,
  opts: ActionRunOpts
): Promise<ActionResult> {
  try {
    return await entry.run(args, opts)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return actionFailed(`${entry.name} crashed: ${message}`)
  }
}
