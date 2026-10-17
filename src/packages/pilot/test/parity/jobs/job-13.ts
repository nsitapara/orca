import { join } from 'node:path'
import type { ScriptRunner } from '../../../src/main/fields/script-runner'
import type { IdsRunner } from '../../../src/main/sources/ids-from'
import { addImportedHandled } from '../../../src/main/store/__fixtures__/imported-rows'
import type { PilotStore } from '../../../src/main/store/store'
import type { VerdictTable } from '../compare'
import type { ParityFixture } from '../fixture'
import { miss } from '../fixture-core'
import { withLinearTickets } from '../linear-fixture'
import { frozenOldSide, type OldDecision } from '../old-side'
import { failed, ok } from '../overrides'
import type { ParityJob } from '../parity-case'
import { loadPortedAutomation, portedAutomationsDir } from '../ported'
import { savedAt, stateObject } from '../sweep-state'

export const JOB_13 = {
  job: '13',
  sweep: 'dev-e2e-fix',
  pipelines: 'dev-e2e-fix',
  starts: 'dev-e2e-fix-start'
}

// 13's words (frozen in each case's old block) and the verdicts that agree with them. pipeline:<id>:
// green and seen (not due), act (started), QUOTA; linear:<ID>: start (started), QUOTA, FAIL (a start the sweep refused,
// "...; retried next run": a failed check), has_session (not due), closed. A ticket that is not this job's is never read
// (where.ids_from), on either side.
export const VERDICTS_13: VerdictTable = {
  map: {
    green: ['notdue'],
    seen: ['notdue'],
    act: ['started'],
    QUOTA: ['skipped'],
    start: ['started'],
    has_session: ['notdue']
  },
  rows: [{ word: 'FAIL', reason: /; retried next run$/, verdicts: ['skipped'] }],
  whenOldMissing: ['out_of_scope'],
  known: [
    {
      key: 'pipeline:19',
      word: 'act',
      verdict: 'skipped',
      why: 'Pilot checks Claude quota before every 13 run; the old sweep checked it only before opening a ticket, so it still commented while Claude was out'
    },
    {
      key: 'linear:WEB-3',
      word: 'closed',
      verdict: 'absent',
      why: 'Pilot lists only tickets in an open state (state_type), so a canceled one has no row; the sweep reported it as closed'
    }
  ]
}

// The sweep's state, as Pilot keeps it: each pipeline in handled.json ({ "<pipeline id>": [tickets] }) is dev-e2e-fix's
// once_per key "<id>"; each ticket in tickets.json whose session started (it has a path) is dev-e2e-fix-start's "<ID>",
// from its start. A ticket without a path stays due, so Pilot starts it, as the old sweep's retry did.
export function seed13(store: PilotStore, f: ParityFixture): void {
  const pipelines = Object.entries(stateObject(f, 'dev-e2e/handled.json'))
    .filter(([pipeline, tickets]) => /^\d+$/.test(pipeline) && Array.isArray(tickets))
    .map(([pipeline]) => ({ onceKey: pipeline, status: 'done' as const, at: f.now }))
  addImportedHandled(store, JOB_13.pipelines, pipelines)
  const started = Object.entries(stateObject(f, 'dev-e2e/tickets.json')).flatMap(
    ([ident, entry]) => {
      const e = (entry ?? {}) as { path?: unknown; startedAt?: unknown }
      return typeof e.path === 'string' && e.path !== ''
        ? [{ onceKey: ident, status: 'done' as const, at: savedAt(f, e.startedAt) }]
        : []
    }
  )
  addImportedHandled(store, JOB_13.starts, started)
}

// The commands 13's YAML runs (pilotcli's since milestone 7), pinned as literals: 13-dev-e2e-fix.parity.test.ts checks
// the YAML names exactly these, and the answers below answer only these.
export const COMMANDS_13 = {
  ticket: 'pilotcli automations run-item dev-e2e-fix "$PIPELINE_ID"',
  listItems: 'pilotcli automations list-items dev-e2e-fix-start --format json',
  checkItem: 'pilotcli automations check-item dev-e2e-fix-start --pilot-item -'
}

// The script check the start automation runs (check-item), answered from the case: the old adapter's frozen verdict on
// the same inputs (the old adapter ran pilot_mode.check_worktree under the case's reads, `script_check` in the case's
// old block), so the check's refusal is compared with the old start()'s. A ticket the old side never checked is a
// missed read, which fails the case.
export function answerScripts(old: OldDecision[], f: ParityFixture): ScriptRunner {
  const checks = new Map(
    old.filter((d) => d.decision === 'script_check').map((d) => [d.key, d.reason])
  )
  return async (req) => {
    if (req.command !== COMMANDS_13.checkItem) {
      throw new Error(`parity: no answer for the script ${req.command}`)
    }
    const key = req.env.PILOT_ITEM_KEY
    const reason = checks.get(key)
    if (reason === undefined) {
      throw miss(f, `${req.command} for ${key}`)
    }
    return reason === '' ? ok() : failed(reason)
  }
}

// where.ids_from (list-items), answered from the case: what pilot_mode.py list-fix-tickets printed for its tickets.json,
// frozen in its old block (exit 3 when none). Any other command fails the tick.
export function answerIds(f: ParityFixture): IdsRunner {
  return async (cmd) => {
    const run = [cmd.program, ...cmd.args].join(' ')
    if (run !== COMMANDS_13.listItems) {
      throw new Error(`parity: no answer for ids_from ${run}`)
    }
    const ids = frozenOldSide(f).ids
    if (!ids) {
      throw miss(f, `ids_from ${run}`)
    }
    return { code: ids.code, stdout: ids.stdout, stderr: '', timedOut: false, truncated: false }
  }
}

function yamlOf(id: string): string {
  return join(portedAutomationsDir(), `${id}.yaml`)
}

function parityJob(id: string, prefix: string, extra: Partial<ParityJob>): ParityJob {
  return {
    job: JOB_13.job,
    files: [yamlOf(id), join(portedAutomationsDir(), 'people.yaml')],
    table: VERDICTS_13,
    ownsKey: (key) => key.startsWith(prefix),
    seed: seed13,
    load() {
      const { definition, people } = loadPortedAutomation(id)
      return { def: definition, people }
    },
    ...extra
  }
}

// One old sweep, two automations: each is compared with the old decisions about its own items.
export const PARITY_13_PIPELINES = parityJob(JOB_13.pipelines, 'pipeline:', {})
export const PARITY_13_STARTS = parityJob(JOB_13.starts, 'linear:', {
  runScriptFor: answerScripts,
  runIdsFor: answerIds,
  tickDeps: withLinearTickets
})
