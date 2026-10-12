import { mkdtempSync, readdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, it } from 'vitest'
import { loadFixture } from './fixture'
import { PARITY_05 } from './jobs/job-05'
import { PARITY_DIR, runOldPlan } from './old-side'
import { describeParity, expectParity, parityReport } from './parity-case'

const CASES = join(PARITY_DIR, '05')
const SYNTHETIC = join(CASES, 'synthetic-basic.json')
const cases = readdirSync(CASES)
  .filter((f) => f.endsWith('.json'))
  .sort()

// Skipped, with what's missing in its title and on stderr, where ~/.agents (or PARITY_SKILLS_DIR /
// PARITY_AUTOMATIONS_DIR) or python3 isn't there.
describeParity(PARITY_05, '05 · Fix failed CI: Pilot decides each MR as ci-fix-sweep does', () => {
  it('replays ci-fix-sweep on the synthetic case without running anything', () => {
    const decided = runOldPlan('05', SYNTHETIC).map((d) => [d.key, d.decision, d.reason])
    expect(decided).toEqual([
      ['mr:101', 'due', ''],
      ['mr:102', 'skip', 'no Orca worktree'],
      ['mr:103', 'absent', 'head pipeline success'],
      ['mr:104', 'absent', 'already handled pipeline 9104'],
      ['mr:105', 'skip', 'uncommitted changes; retry next round']
    ])
  })

  it.each(cases)('%s: the same decision for every MR, from reads the case holds', async (name) => {
    await expectParity(PARITY_05, join(CASES, name))
  })

  // !105 is dirty, so both sides skip it whatever its git-operation markers say: a case lacking one
  // of them agrees on every verdict, and only the missed read fails it.
  it('fails a case when the new side reads what the fixture lacks, though every verdict agrees', async () => {
    const marker = ['git', '-C', '/tmp/parity-05/wt-105', 'rev-parse', '--git-path', 'MERGE_HEAD']
    const fixture = loadFixture(SYNTHETIC)
    fixture.reads = fixture.reads.filter((r) => r.argv.join(' ') !== marker.join(' '))
    const file = join(mkdtempSync(join(tmpdir(), 'pilot-parity-')), 'missing-marker.json')
    writeFileSync(file, JSON.stringify(fixture))
    expect(await parityReport(PARITY_05, loadFixture(file), runOldPlan('05', file))).toBe(
      `missed read: ${marker.join(' ')}`
    )
    await expect(expectParity(PARITY_05, file)).rejects.toMatchObject({
      actual: `missed read: ${marker.join(' ')}`
    })
  })
})
