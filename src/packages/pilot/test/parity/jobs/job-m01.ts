import { join } from 'node:path'
import type { ScriptRunner } from '../../../src/main/fields/script-runner'
import { addImportedHandled } from '../../../src/main/store/__fixtures__/imported-rows'
import type { PilotStore } from '../../../src/main/store/store'
import type { VerdictTable } from '../compare'
import type { ParityFixture } from '../fixture'
import { withLinearTickets } from '../linear-fixture'
import type { OldDecision } from '../old-side'
import { failed, ok } from '../overrides'
import type { ParityJob } from '../parity-case'
import { loadPortedAutomation, portedAutomationsDir } from '../ported'
import { savedAt, stateObject } from '../sweep-state'

export const JOB_M01 = {
  job: 'M01',
  sweep: 'linear-todo-sweep',
  loop: 'linear-todo',
  automationId: 'linear-todo'
}

// M01's words (frozen in each case's old block) and the verdicts that agree with them. decide()'s skips: no branch name is a `where`
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

// started.json ({ "<ID>": { path, handle, startedAt } }) as Pilot keeps it: every kicked-off ticket is linear-todo.yaml's
// once_per "<ID>", from its start, so Pilot never kicks it off again.
export function seedM01(store: PilotStore, f: ParityFixture): void {
  const started = Object.entries(stateObject(f, `${JOB_M01.loop}/started.json`)).map(
    ([ident, entry]) => ({
      onceKey: ident,
      status: 'done' as const,
      at: savedAt(f, (entry as { startedAt?: unknown } | null)?.startedAt)
    })
  )
  addImportedHandled(store, JOB_M01.automationId, started)
}

// The command M01's YAML checks each ticket with (pilotcli's since milestone 8), pinned as a literal: the definition test
// checks the YAML names exactly this, and the answer below answers only this.
export const COMMANDS_M01 = {
  checkItem: 'pilotcli automations check-item linear-todo --pilot-item -'
}

// The script check answered from the old adapter's verdict on the same reads (the old adapter ran sweep.check: the
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
