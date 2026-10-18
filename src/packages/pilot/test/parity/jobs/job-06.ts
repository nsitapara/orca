import { readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { parseAutomationYaml } from '../../../src/shared/definition/parse'
import type { AutomationDefinition } from '../../../src/shared/definition/types'
import { parsePeopleYaml, type PeopleDirectory } from '../../../src/shared/people'
import type { ScriptRunner } from '../../../src/main/fields/script-runner'
import type { PilotStore } from '../../../src/main/store/store'
import type { VerdictTable } from '../compare'
import type { ParityFixture } from '../fixture'
import type { ParityJob } from '../parity-case'
import { seedTabSessions } from '../sweep-state'

export const JOB_06 = {
  job: '06',
  automationId: 'mr-feedback',
  sweep: 'mr-feedback-sweep',
  yaml: join(
    process.env.PARITY_AUTOMATIONS_DIR ?? join(homedir(), '.agents', 'automations'),
    'mr-feedback.yaml'
  )
}

// 06's words (frozen in the test data) and the verdicts that agree with them. An MR with no thread waiting on me got no word
// from the sweep; the engine's `match` puts it out of scope.
export const VERDICTS_06: VerdictTable = {
  map: {
    due: ['started'],
    skip: ['skipped'],
    defer: ['over_limit'],
    quota: ['skipped'],
    absent: ['out_of_scope']
  },
  // The sweep skipped an MR whose worktree was dirty or mid-operation; the env's busy check replaces that gate
  // (pilotcli M4 §8): the item starts in a throwaway, waits for the limit its start now uses, or is held by the quota
  // check. The open-tab gate stays (session: none_open).
  rows: [
    {
      word: 'skip',
      reason: /^(uncommitted changes|\S+ present); retry next round$/,
      verdicts: ['started', 'over_limit', 'skipped']
    }
  ],
  // Those started MRs take the per-tick slots that the sweep gave to later due MRs.
  known: [
    {
      key: 'mr:1715',
      word: 'due',
      verdict: 'over_limit',
      why: 'An MR the sweep skipped for a dirty worktree now starts, and takes one of the three slots of the tick'
    }
  ],
  whenOldMissing: []
}

// 06's inline script check (commits that wait to be pushed hold the MR back), has no counterpart in the sweep, and a
// case holds no branch to ask about: every MR passes it, so the verdicts are the sweep's own gates.
export const answerDue: ScriptRunner = async (req) => {
  if (!req.command.includes('pilotcli git get-branch --format value --field unpushed')) {
    throw new Error(`parity: no answer for the script ${req.command}`)
  }
  return { code: 0, stdout: 'nothing waits to be pushed\n', stderr: '', timedOut: false }
}

// The sweep kept no handled state (it re-checked every MR's threads each tick), only its feedback tabs: each one a
// finished imported run whose step names its terminal.
export function seed06(store: PilotStore, f: ParityFixture): void {
  seedTabSessions(store, JOB_06.automationId, f, 'mr-feedback')
}

// The real YAML and people.yaml: parity is about the file that will run.
export function load06(): { def: AutomationDefinition; people: PeopleDirectory } {
  const parsed = parseAutomationYaml(readFileSync(JOB_06.yaml, 'utf8'), JOB_06.yaml)
  if (!parsed.ok) {
    throw new Error(parsed.errors.join('\n'))
  }
  const people = parsePeopleYaml(readFileSync(join(dirname(JOB_06.yaml), 'people.yaml'), 'utf8'))
  if (!people.ok) {
    throw new Error(people.errors.join('\n'))
  }
  return { def: parsed.definition, people: people.directory }
}

// What the shared parity runner (parity-case.ts) needs for 06. mr-feedback-sweep's decisions are frozen in each case's
// old block, recorded before the sweep was deleted.
export const PARITY_06: ParityJob = {
  job: JOB_06.job,
  files: [JOB_06.yaml, join(dirname(JOB_06.yaml), 'people.yaml')],
  table: VERDICTS_06,
  runScript: answerDue,
  seed: seed06,
  load: load06
}
