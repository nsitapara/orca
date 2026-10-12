import { existsSync } from 'node:fs'
import { describe, expect } from 'vitest'
import { runTick } from '../../src/main/scheduler/tick-runner'
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
import { oldSideMissing, runOldPlan, type OldDecision } from './old-side'

// What a job's parity test hands the shared runner (jobs/job-<code>.ts).
export type ParityJob = {
  job: string
  // The old side's own code: <skills>/<folder>/<script> (script defaults to sweep.py).
  folder: string
  script?: string
  // The files the new side reads: the automation's YAML and people.yaml.
  files: string[]
  table: VerdictTable
  seed(store: PilotStore, f: ParityFixture): void
  load(): { def: AutomationDefinition; people: PeopleDirectory }
}

export function parityMissing(job: ParityJob): string[] {
  return [...oldSideMissing(job.folder, job.script), ...job.files.filter((p) => !existsSync(p))]
}

// A job's parity suite. Where python3, the old code or the YAML is missing it is skipped, and its
// title and stderr say what's missing, so a green run without them reads as a skip.
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
    const result = await runTick(def, people, fixtureTickDeps(fixture, store), {
      dryRun: true,
      pass: fixturePass(fixture)
    })
    return [
      result.error === null ? '' : `tick failed: ${result.error}`,
      ...fixtureMisses(fixture).map((what) => `missed read: ${what}`),
      formatMismatches(compareDecisions(old, result.decisions, job.table))
    ]
      .filter((line) => line !== '')
      .join('\n')
  } finally {
    store.close()
  }
}

// Both sides on one recorded case: nothing may keep it from passing.
export async function expectParity(job: ParityJob, file: string): Promise<void> {
  expect(await parityReport(job, loadFixture(file), runOldPlan(job.job, file))).toBe('')
}
