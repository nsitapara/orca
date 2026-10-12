import { readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { mrFeedbackState } from '../../../src/main/importer/sweep-state/mr-feedback'
import { parseAutomationYaml } from '../../../src/shared/definition/parse'
import type { AutomationDefinition } from '../../../src/shared/definition/types'
import { parsePeopleYaml, type PeopleDirectory } from '../../../src/shared/people'
import type { VerdictTable } from '../compare'
import { seedByImport } from '../fixture-reader'
import type { ParityJob } from '../parity-case'

export const JOB_06 = {
  job: '06',
  automationId: 'mr-feedback',
  sweep: 'mr-feedback-sweep',
  yaml: join(
    process.env.PARITY_AUTOMATIONS_DIR ?? join(homedir(), '.agents', 'automations'),
    'mr-feedback.yaml'
  )
}

// 06's words (jobs/job_06.py) and the verdicts that agree with them. An MR with no thread waiting on me got no word
// from the sweep; the engine's `match` puts it out of scope.
export const VERDICTS_06: VerdictTable = {
  map: {
    due: ['started'],
    skip: ['skipped'],
    defer: ['over_limit'],
    quota: ['skipped'],
    absent: ['out_of_scope']
  },
  whenOldMissing: []
}

// The sweep's open feedback tabs, brought in as import-state would.
export const seed06 = seedByImport(mrFeedbackState)

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

// What the shared parity runner (parity-case.ts) needs for 06.
export const PARITY_06: ParityJob = {
  job: JOB_06.job,
  folder: JOB_06.sweep,
  files: [JOB_06.yaml, join(dirname(JOB_06.yaml), 'people.yaml')],
  table: VERDICTS_06,
  seed: seed06,
  load: load06
}
