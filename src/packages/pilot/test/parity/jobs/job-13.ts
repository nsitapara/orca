import { join } from 'node:path'
import { applyImport } from '../../../src/main/importer/sweep-state/apply'
import {
  devE2ePipelinesMapper,
  devE2eStartsMapper
} from '../../../src/main/importer/sweep-state/dev-e2e'
import type { ScriptRunner } from '../../../src/main/fields/script-runner'
import type { PilotStore } from '../../../src/main/store/store'
import type { VerdictTable } from '../compare'
import type { ParityFixture } from '../fixture'
import { fixtureStateReader } from '../fixture-reader'
import { withLinearTickets } from '../linear-fixture'
import type { OldDecision } from '../old-side'
import { failed, ok } from '../overrides'
import type { ParityJob } from '../parity-case'
import { loadPortedAutomation, portedAutomationsDir } from '../ported'

export const JOB_13 = {
  job: '13',
  sweep: 'dev-e2e-fix',
  loop: 'dev-e2e',
  pipelines: 'dev-e2e-fix',
  starts: 'dev-e2e-fix-start'
}

// 13's words (jobs/job_13.py) and the verdicts that agree with them. pipeline:<id>: green and seen (not due), act (started),
// QUOTA; linear:<ID>: start (started), QUOTA, FAIL (a start the sweep refused, "...; retried next run": a failed check),
// has_session (not due), closed. A ticket that is not this job's has no word: out of scope.
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
      key: 'pipeline:9',
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

// The sweep's state, as Pilot keeps it: the two mappers' plans applied to the case's state files (each handled pipeline is
// dev-e2e-fix's once_per key "<id>"; each ticket whose session started is dev-e2e-fix-start's "<ID>"), so the import and
// the decisions are tested together.
export function seed13(store: PilotStore, f: ParityFixture): void {
  const read = fixtureStateReader(f)
  applyImport(store, devE2ePipelinesMapper.plan(read), f.now)
  applyImport(store, devE2eStartsMapper.plan(read), f.now)
}

type Ticket = { closed?: boolean }

// The scripts the start automation runs, answered from the case: `field-fix-ticket` from the case's tickets.json (what
// pilot_mode.py reads), and `check-worktree` from the old adapter's verdict on the same inputs (jobs/job_13.py runs
// pilot_mode.check_worktree under the case's reads), so the check's refusal is compared with the old start()'s.
export function answerScripts(old: OldDecision[], f: ParityFixture): ScriptRunner {
  const tickets = (f.state[`${JOB_13.loop}/tickets.json`] ?? {}) as Record<string, Ticket>
  const checks = new Map(
    old.filter((d) => d.decision === 'script_check').map((d) => [d.key, d.reason])
  )
  return async (req) => {
    const key = req.env.PILOT_ITEM_KEY
    if (req.command.includes('field-fix-ticket')) {
      const ticket = tickets[key.replace('linear:', '')]
      return ok(ticket && !ticket.closed ? 'true' : 'false')
    }
    if (req.command.includes('check-worktree')) {
      const reason = checks.get(key) ?? ''
      return reason === '' ? ok() : failed(reason)
    }
    throw new Error(`parity: no answer for the script ${req.command}`)
  }
}

function yamlOf(id: string): string {
  return join(portedAutomationsDir(), `${id}.yaml`)
}

function parityJob(id: string, prefix: string, extra: Partial<ParityJob>): ParityJob {
  return {
    job: JOB_13.job,
    folder: JOB_13.sweep,
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
  tickDeps: withLinearTickets
})
