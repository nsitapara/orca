import { existsSync } from 'node:fs'
import { describe, expect } from 'vitest'
import { runTick, type TickDeps } from '../../src/main/scheduler/tick-runner'
import type { ScriptRunner } from '../../src/main/fields/script-runner'
import type { IdsRunner } from '../../src/main/sources/ids-from'
import { PilotStore } from '../../src/main/store/store'
import type { AutomationDefinition } from '../../src/shared/definition/types'
import type { PeopleDirectory } from '../../src/shared/people'
import { compareDecisions, formatMismatches, type VerdictTable } from './compare'
import {
  fixtureMisses,
  fixturePass,
  fixtureTickDeps,
  loadFixture,
  type ParityFixture
} from './fixture'
import { frozenOldPlan, type OldDecision } from './old-side'

// What a job's parity test hands the shared runner (jobs/job-<code>.ts).
export type ParityJob = {
  job: string
  // The files the new side reads: the automation's YAML and people.yaml.
  files: string[]
  table: VerdictTable
  // Answers every script the same way, whatever the case: 06's inline due check.
  runScript?: ScriptRunner
  // The old side's own answers, for a script the new side can only run against the case: 13's worktree check (a decision
  // word `script_check` (key, reason: '' = passed) is no verdict, only the answer this returns for that key) and 09's
  // field scripts (the case's frozen `sweep.py field` output).
  runScriptFor?(old: OldDecision[], fixture: ParityFixture): ScriptRunner
  // Answers where.ids_from from the case (13: what list-fix-tickets printed for its tickets.json, frozen).
  runIdsFor?(fixture: ParityFixture): IdsRunner
  // Swaps parts of the tick's deps: 13's Linear tickets, which the case's reads supply (test/parity/linear-fixture.ts).
  tickDeps?(deps: TickDeps, fixture: ParityFixture): TickDeps
  // One old sweep, two automations (13): each job compares the old decisions whose key it lists.
  ownsKey?(key: string): boolean
  seed(store: PilotStore, f: ParityFixture): void
  load(): { def: AutomationDefinition; people: PeopleDirectory }
}

export function parityMissing(job: ParityJob): string[] {
  return job.files.filter((p) => !existsSync(p))
}

// A job's parity suite. Where the YAML is missing it is skipped, and its title and stderr say what's missing, so a
// green run without it reads as a skip. The old side is frozen in each case file, so no old code is looked for.
export function describeParity(job: ParityJob, title: string, body: () => void): void {
  const missing = parityMissing(job)
  if (missing.length === 0) {
    describe(title, body)
    return
  }
  const reason = `skipped: not found: ${missing.join(', ')}`
  process.stderr.write(`[parity] ${title}: ${reason}\n`)
  describe.skip(`${title} (${reason})`, body)
}

function scripts(
  job: ParityJob,
  old: OldDecision[],
  fixture: ParityFixture
): ScriptRunner | undefined {
  return job.runScriptFor ? job.runScriptFor(old, fixture) : job.runScript
}

function withJobDeps(job: ParityJob, fixture: ParityFixture, deps: TickDeps): TickDeps {
  return job.tickDeps ? job.tickDeps(deps, fixture) : deps
}

// The old decisions this job's verdicts are compared with: no script answers, only the keys the job owns.
function compared(job: ParityJob, old: OldDecision[]): OldDecision[] {
  return old.filter((d) => d.decision !== 'script_check' && (job.ownsKey?.(d.key) ?? true))
}

// What keeps a case from passing, a line each: the tick's error, every read the new side made that
// the case lacks, and every verdict that disagrees. Pilot's field reads fail soft (the field reads
// unknown), so a missed read can still land on the old side's verdict: it fails the case by itself.
export async function parityReport(
  job: ParityJob,
  fixture: ParityFixture,
  old: OldDecision[]
): Promise<string> {
  const store = PilotStore.open(':memory:')
  try {
    job.seed(store, fixture)
    const { def, people } = job.load()
    const result = await runTick(
      def,
      people,
      withJobDeps(
        job,
        fixture,
        fixtureTickDeps(fixture, store, {
          runScript: scripts(job, old, fixture),
          runIds: job.runIdsFor?.(fixture)
        })
      ),
      {
        dryRun: true,
        pass: fixturePass(fixture)
      }
    )
    return [
      result.error === null ? '' : `tick failed: ${result.error}`,
      ...fixtureMisses(fixture).map((what) => `missed read: ${what}`),
      formatMismatches(compareDecisions(compared(job, old), result.decisions, job.table))
    ]
      .filter((line) => line !== '')
      .join('\n')
  } finally {
    store.close()
  }
}

// The old side's decisions on a case, as frozen in the case file.
export function oldPlanOf(_job: ParityJob, file: string): OldDecision[] {
  return frozenOldPlan(file)
}

// Both sides on one recorded case: nothing may keep it from passing.
export async function expectParity(job: ParityJob, file: string): Promise<void> {
  expect(await parityReport(job, loadFixture(file), oldPlanOf(job, file))).toBe('')
}
