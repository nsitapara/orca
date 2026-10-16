import { readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { reviewRequestsState } from '../../../src/main/importer/sweep-state/review-requests'
import type { ScriptRunner } from '../../../src/main/fields/script-runner'
import { parseAutomationYaml } from '../../../src/shared/definition/parse'
import type { AutomationDefinition } from '../../../src/shared/definition/types'
import { parsePeopleYaml, type PeopleDirectory } from '../../../src/shared/people'
import type { VerdictTable } from '../compare'
import type { ParityFixture } from '../fixture'
import { miss } from '../fixture-core'
import { seedByImport } from '../fixture-reader'
import { frozenOldSide } from '../old-side'
import { ok } from '../overrides'
import type { ParityJob } from '../parity-case'

export const JOB_09 = {
  job: '09',
  automationId: 'review-requests',
  sweep: 'review-requests',
  yaml: join(
    process.env.PARITY_AUTOMATIONS_DIR ?? join(homedir(), '.agents', 'automations'),
    'review-requests.yaml'
  )
}

// 09's words (jobs/job_09.py, plan_pass's log, frozen in each case's old block) and the verdicts that agree with them.
// An MR that isn't a review request of mine has no word: GitLab's reviewer filter never lists it, for either side. An
// approved MR is out of scope on the engine (approved_by: none) with the approvers named, as the sweep's skip reasons
// name them.
export const VERDICTS_09: VerdictTable = {
  map: { ask: ['asked'], already: ['notdue'], skip: ['out_of_scope'] },
  rows: [
    { word: 'skip', reason: /^your own MR$/, verdicts: ['out_of_scope'] },
    { word: 'skip', reason: /^you approved it$/, verdicts: ['out_of_scope'] },
    { word: 'skip', reason: /^approved by /, verdicts: ['out_of_scope'] }
  ],
  whenOldMissing: []
}

// The heads the old notes offered, brought in as import-state would.
export const seed09 = seedByImport(reviewRequestsState)

// The fields' scripts (pilotcli's since milestone 7), pinned as literals: review-requests.test.ts checks the YAML names
// exactly these.
export const FIELD_SCRIPTS_09 = {
  head8: 'pilotcli automations get-field review-requests head8',
  context: 'pilotcli automations get-field review-requests context'
}

// The field scripts, answered from the case: what the skill's own pure `sweep.py field <name>` printed for each item
// Pilot asked (item JSON on stdin), frozen in the case's old block. An item or a field it lacks is a missed read, which
// fails the case.
export function answerFields(f: ParityFixture): ScriptRunner {
  return async (req) => {
    const name = Object.entries(FIELD_SCRIPTS_09).find(([, run]) => run === req.command)?.[0]
    if (name === undefined) {
      throw new Error(`parity: no answer for the script ${req.command}`)
    }
    const key = req.env.PILOT_ITEM_KEY
    const stdout = frozenOldSide(f).fields?.[key]?.[name]
    if (stdout === undefined) {
      throw miss(f, `${req.command} for ${key}`)
    }
    return ok(stdout)
  }
}

export function load09(): { def: AutomationDefinition; people: PeopleDirectory } {
  const parsed = parseAutomationYaml(readFileSync(JOB_09.yaml, 'utf8'), JOB_09.yaml)
  if (!parsed.ok) {
    throw new Error(parsed.errors.join('\n'))
  }
  const people = parsePeopleYaml(readFileSync(join(dirname(JOB_09.yaml), 'people.yaml'), 'utf8'))
  if (!people.ok) {
    throw new Error(people.errors.join('\n'))
  }
  return { def: parsed.definition, people: people.directory }
}

export const PARITY_09: ParityJob = {
  job: JOB_09.job,
  folder: JOB_09.sweep,
  frozen: true,
  files: [JOB_09.yaml, join(dirname(JOB_09.yaml), 'people.yaml')],
  table: VERDICTS_09,
  seed: seed09,
  runScriptFor: (_old, f) => answerFields(f),
  load: load09
}
