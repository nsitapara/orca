import { join } from 'node:path'
import { applyImport } from '../../../src/main/importer/sweep-state/apply'
import { linearTodoMapper } from '../../../src/main/importer/sweep-state/linear-todo'
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

export const JOB_M01 = {
  job: 'M01',
  sweep: 'linear-todo-sweep',
  loop: 'linear-todo',
  automationId: 'linear-todo'
}

// M01's words (jobs/job_m01.py, frozen in each case's old block) and the verdicts that agree with them. decide()'s skips: no branch name is a `where`
// clause (out of scope), a kickoff already made is once_per (not due), the rest are the script check with the same
// reason (skipped). A ticket the old sweep never lists (not in Todo) has no word: out of scope.
export const VERDICTS_M01: VerdictTable = {
  map: { start: ['started'], defer: ['over_limit'], QUOTA: ['skipped'] },
  rows: [
    { word: 'skip', reason: /^no branch name in Linear$/, verdicts: ['out_of_scope'] },
    { word: 'skip', reason: /^kickoff session still open$|^kicked off /, verdicts: ['notdue'] },
    { word: 'skip', verdicts: ['skipped'] }
  ],
  whenOldMissing: ['out_of_scope'],
  known: [
    {
      key: 'linear:WEB-1',
      word: 'defer',
      verdict: 'skipped',
      why: 'the old sweep counted a quota-out ticket toward --max, so the fourth was deferred; Pilot skips every one on the quota check'
    },
    {
      key: 'linear:WEB-1',
      word: 'skip',
      verdict: 'started',
      why: "the old sweep reused any worktree linked to the ticket, whatever its name; Pilot reuses by worktree name or branch, so a worktree linked under another name is left alone and the branch's own worktree is made"
    }
  ]
}

// started.json as Pilot keeps it: the mapper's plan applied to the case, so every kicked-off ticket is
// linear-todo.yaml's once_per "<ID>" (sweep-state/linear-todo.ts).
export function seedM01(store: PilotStore, f: ParityFixture): void {
  applyImport(store, linearTodoMapper.plan(fixtureStateReader(f)), f.now)
}

// The command M01's YAML checks each ticket with (pilotcli's since milestone 8), pinned as a literal: the definition test
// checks the YAML names exactly this, and the answer below answers only this.
export const COMMANDS_M01 = {
  checkItem: 'pilotcli automations check-item linear-todo --pilot-item -'
}

// The script check answered from the old adapter's verdict on the same reads (jobs/job_m01.py ran sweep.check: the
// `script_check` decisions frozen in the case's old block).
export function answerScripts(old: OldDecision[]): ScriptRunner {
  const checks = new Map(
    old.filter((d) => d.decision === 'script_check').map((d) => [d.key, d.reason])
  )
  return async (req) => {
    if (req.command !== COMMANDS_M01.checkItem) {
      throw new Error(`parity: no answer for the script ${req.command}`)
    }
    const reason = checks.get(req.env.PILOT_ITEM_KEY) ?? ''
    return reason === '' ? ok() : failed(reason)
  }
}

// sweep.py's decisions are frozen in each case's old block (milestone 8 deletes it); a case without them fails.
export const PARITY_M01: ParityJob = {
  job: JOB_M01.job,
  folder: JOB_M01.sweep,
  frozen: true,
  files: [
    join(portedAutomationsDir(), 'linear-todo.yaml'),
    join(portedAutomationsDir(), 'people.yaml')
  ],
  table: VERDICTS_M01,
  seed: seedM01,
  runScriptFor: answerScripts,
  tickDeps: withLinearTickets,
  load() {
    const { definition, people } = loadPortedAutomation(JOB_M01.automationId)
    return { def: definition, people }
  }
}
