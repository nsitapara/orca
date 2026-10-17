import { readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import type { PilotStore } from '../../../src/main/store/store'
import { parseAutomationYaml } from '../../../src/shared/definition/parse'
import type { AutomationDefinition } from '../../../src/shared/definition/types'
import { parsePeopleYaml, type PeopleDirectory } from '../../../src/shared/people'
import type { VerdictTable } from '../compare'
import type { ParityFixture } from '../fixture'
import type { ParityJob } from '../parity-case'

const HOUR = 60 * 60_000

export const JOB_05 = {
  job: '05',
  automationId: 'fix-failed-ci',
  sweep: 'ci-fix-sweep',
  loop: 'ci-fix',
  yaml: join(
    process.env.PARITY_AUTOMATIONS_DIR ?? join(homedir(), '.agents', 'automations'),
    'fix-failed-ci.yaml'
  )
}

// 05's words (jobs/job_05.py) and the verdicts that agree with them.
export const VERDICTS_05: VerdictTable = {
  map: {
    due: ['started'],
    skip: ['skipped'],
    defer: ['over_limit'],
    quota: ['skipped'],
    absent: ['notdue']
  },
  // The sweep skipped an MR whose worktree was dirty, mid-operation or had its tab open; the env's busy check
  // replaces those gates (pilotcli M4 §8): the item starts in a throwaway, waits for the limit its start now uses, or is held by the quota check (which runs for every MR).
  rows: [
    {
      word: 'skip',
      reason:
        /^(uncommitted changes|\S+ present); retry next round$|^previous CI-fix session still open$/,
      verdicts: ['started', 'over_limit', 'skipped']
    }
  ],
  // Those started MRs take the per-tick slots that the sweep gave to later due MRs.
  known: [
    {
      key: 'mr:1605',
      word: 'due',
      verdict: 'over_limit',
      why: 'MRs the sweep skipped for a busy worktree now start, and take the three slots of the tick'
    },
    {
      key: 'mr:1606',
      word: 'due',
      verdict: 'over_limit',
      why: 'MRs the sweep skipped for a busy worktree now start, and take the three slots of the tick'
    }
  ],
  whenOldMissing: ['out_of_scope']
}

// The sweep's state, as Pilot keeps it: handled.json pipelines are handled once_per keys
// ("<iid>:<pipeline>", as seed-handled-from-sweep.mjs maps them), and each tab in tabs*.json is a
// finished step whose terminal the session check asks about.
export function seed05(store: PilotStore, f: ParityFixture): void {
  const handled = (f.state[`${JOB_05.loop}/handled.json`] ?? {}) as Record<string, number>
  for (const [iid, pipeline] of Object.entries(handled)) {
    store.markHandled(JOB_05.automationId, `${iid}:${pipeline}`, null, f.now)
  }
  const tabs = [
    ...Object.entries((f.state[`${JOB_05.loop}/tabs.json`] ?? {}) as Record<string, string>),
    ...Object.entries((f.state[`${JOB_05.loop}/tabs-codex.json`] ?? {}) as Record<string, string>)
  ]
  tabs.forEach(([path, handle], n) => {
    const id = `parity-tab-${n + 1}`
    store.runs.create({
      id,
      automationId: JOB_05.automationId,
      tickId: null,
      itemKey: id,
      itemLabel: id,
      worktreePath: path,
      startedAt: f.now - 2 * HOUR
    })
    store.runs.createStep({
      runId: id,
      idx: 0,
      name: 'step1',
      agent: 'claude',
      skill: 'fix-gitlab-ci',
      startedAt: f.now - 2 * HOUR
    })
    store.runs.updateStep(id, 0, {
      status: 'done',
      terminalHandle: handle,
      paneKey: `parity:${n + 1}`,
      finishedAt: f.now - HOUR
    })
    store.runs.update(id, { status: 'done', finishedAt: f.now - HOUR })
  })
}

// The real YAML and people.yaml: parity is about the file that will run.
export function load05(): { def: AutomationDefinition; people: PeopleDirectory } {
  const parsed = parseAutomationYaml(readFileSync(JOB_05.yaml, 'utf8'), JOB_05.yaml)
  if (!parsed.ok) {
    throw new Error(parsed.errors.join('\n'))
  }
  const people = parsePeopleYaml(readFileSync(join(dirname(JOB_05.yaml), 'people.yaml'), 'utf8'))
  if (!people.ok) {
    throw new Error(people.errors.join('\n'))
  }
  return { def: parsed.definition, people: people.directory }
}

// What the shared parity runner (parity-case.ts) needs for 05. ci-fix-sweep's decisions are frozen in each case's old
// block, recorded before the sweep was deleted.
export const PARITY_05: ParityJob = {
  job: JOB_05.job,
  folder: JOB_05.sweep,
  frozen: true,
  files: [JOB_05.yaml, join(dirname(JOB_05.yaml), 'people.yaml')],
  table: VERDICTS_05,
  seed: seed05,
  load: load05
}
