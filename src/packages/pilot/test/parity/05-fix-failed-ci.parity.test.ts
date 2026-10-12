import { existsSync, readdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { runTick } from '../../src/main/scheduler/tick-runner'
import { PilotStore } from '../../src/main/store/store'
import { compareDecisions, formatMismatches } from './compare'
import { fixturePass, fixtureTickDeps, loadFixture } from './fixture'
import { JOB_05, load05, seed05, VERDICTS_05 } from './jobs/job-05'
import { canRunOldSide, PARITY_DIR, runOldPlan } from './old-side'

const CASES = join(PARITY_DIR, '05')
const cases = readdirSync(CASES)
  .filter((f) => f.endsWith('.json'))
  .sort()
const ready =
  canRunOldSide(JOB_05.sweep) &&
  existsSync(JOB_05.yaml) &&
  existsSync(join(dirname(JOB_05.yaml), 'people.yaml'))

// Skips where ~/.agents (or PARITY_SKILLS_DIR / PARITY_AUTOMATIONS_DIR) or python3 isn't there.
describe.skipIf(!ready)('05 · Fix failed CI: Pilot decides each MR as ci-fix-sweep does', () => {
  it('replays ci-fix-sweep on the synthetic case without running anything', () => {
    const decided = runOldPlan('05', join(CASES, 'synthetic-basic.json')).map((d) => [
      d.key,
      d.decision,
      d.reason
    ])
    expect(decided).toEqual([
      ['mr:101', 'due', ''],
      ['mr:102', 'skip', 'no Orca worktree'],
      ['mr:103', 'absent', 'head pipeline success'],
      ['mr:104', 'absent', 'already handled pipeline 9104'],
      ['mr:105', 'skip', 'uncommitted changes; retry next round']
    ])
  })

  it.each(cases)('%s: the same decision for every MR', async (name) => {
    const file = join(CASES, name)
    const fixture = loadFixture(file)
    const old = runOldPlan('05', file)
    const store = PilotStore.open(':memory:')
    seed05(store, fixture)
    const { def, people } = load05()
    const result = await runTick(def, people, fixtureTickDeps(fixture, store), {
      dryRun: true,
      pass: fixturePass(fixture)
    })
    expect(result.error).toBeNull()
    expect(formatMismatches(compareDecisions(old, result.decisions, VERDICTS_05))).toBe('')
  })
})
