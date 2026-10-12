import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { reviewRequestsState } from '../../../src/main/importer/sweep-state/review-requests'
import type { ScriptRunner } from '../../../src/main/fields/script-runner'
import { parseAutomationYaml } from '../../../src/shared/definition/parse'
import type { AutomationDefinition } from '../../../src/shared/definition/types'
import { parsePeopleYaml, type PeopleDirectory } from '../../../src/shared/people'
import type { VerdictTable } from '../compare'
import { seedByImport } from '../fixture-reader'
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

// 09's words (jobs/job_09.py, plan_pass's log) and the verdicts that agree with them. An MR that isn't a review request
// of mine has no word: GitLab's reviewer filter never lists it, for either side. An approved MR is out of scope on the
// engine (approved_by: none) with the approvers named, as the sweep's skip reasons name them.
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

// The fields' scripts are the skill's own pure `sweep.py field` (item JSON on stdin, JSON on stdout): they run for real.
export const runFieldScript: ScriptRunner = async (req) => {
  const done = spawnSync('/bin/sh', ['-c', req.command], { input: req.stdin, encoding: 'utf8' })
  return { code: done.status, stdout: done.stdout, stderr: done.stderr, timedOut: false }
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
  files: [JOB_09.yaml, join(dirname(JOB_09.yaml), 'people.yaml')],
  table: VERDICTS_09,
  seed: seed09,
  runScript: runFieldScript,
  load: load09
}
