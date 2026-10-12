import { mkdtempSync, readdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, it } from 'vitest'
import { fixFailedCiState } from '../../src/main/importer/sweep-state/fix-failed-ci'
import { compareDecisions, formatMismatches } from './compare'
import { loadFixture } from './fixture'
import { seedByImport } from './fixture-reader'
import { JOB_05, PARITY_05, VERDICTS_05, load05 } from './jobs/job-05'
import { PARITY_DIR, runOldPlan } from './old-side'
import { caseFile, dryTick, failedCheck } from './ported'
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

const IMPORTED = '2026-10-10-1210'

// Task 38b: the same cases with the sweep's state brought in through `fixFailedCiState`, as `import-state --apply` does.
describeParity(PARITY_05, "05 · Fix failed CI v2: the sweep's state, imported", () => {
  const { def, people } = load05()
  const decide = (name: string) =>
    dryTick({
      definition: def,
      people,
      fixture: loadFixture(caseFile(JOB_05.job, name)),
      seed: seedByImport(fixFailedCiState)
    })

  it('decides as the sweep did with the state imported through the mapper', async () => {
    const neu = await decide(IMPORTED)
    expect(
      formatMismatches(
        compareDecisions(runOldPlan('05', caseFile('05', IMPORTED)), neu, VERDICTS_05)
      )
    ).toBe('')
  })

  it("never retries a pipeline the sweep's handled.json names, once imported", async () => {
    const neu = await decide(IMPORTED)
    expect(neu.find((d) => d.key === 'mr:1587')).toMatchObject({
      verdict: 'notdue',
      onceKey: '1587:2933991087'
    })
  })

  it('starts the first three MRs the sweep started, skips with the check it named, and caps the fourth', async () => {
    const neu = await decide(IMPORTED)
    expect(neu.filter((d) => d.verdict === 'started').map((d) => d.key)).toEqual([
      'mr:1561',
      'mr:1605',
      'mr:1606'
    ])
    expect(neu.find((d) => d.key === 'mr:1607')?.verdict).toBe('over_limit')
    const skipped = neu.filter((d) => d.verdict === 'skipped').map((d) => [d.key, failedCheck(d)])
    expect(skipped).toEqual([
      ['mr:1574', 'Clean'],
      ['mr:1592', 'No open session'],
      ['mr:1601', 'Worktree'],
      ['mr:1603', 'Clean'],
      ['mr:1604', 'Clean']
    ])
  })

  // The ruling for 05: skip reasons, not only verdicts (no worktree vs uncommitted vs tab still open), on every case.
  it.each(cases)(
    "%s: each MR is skipped for the check that names the sweep's reason",
    async (name) => {
      const byReason: [RegExp, string][] = [
        [/^no Orca worktree$/, 'Worktree'],
        [/^previous CI-fix session still open$/, 'No open session'],
        [/^(uncommitted changes|\S+ present); retry next round$/, 'Clean'],
        [/^claude .*(weekly|session)/, 'Quota']
      ]
      const neu = await decide(name.replace(/\.json$/, ''))
      const old = runOldPlan('05', join(CASES, name)).filter(
        (d) => d.decision === 'skip' || d.decision === 'quota'
      )
      for (const d of old) {
        const expected = byReason.find(([re]) => re.test(d.reason))?.[1]
        expect([d.key, d.reason, failedCheck(neu.find((n) => n.key === d.key))]).toEqual([
          d.key,
          d.reason,
          expected
        ])
      }
    }
  )

  // M1 put "clean" before "session"; the sweep tests the open tab first, so a dirty worktree with its tab open
  // is skipped for the tab.
  it('skips an MR with an open tab and a dirty worktree for the open tab, as the sweep does', async () => {
    const old = runOldPlan('05', caseFile(JOB_05.job, 'tab-and-dirty'))
    expect(old).toMatchObject([
      { key: 'mr:1610', decision: 'skip', reason: 'previous CI-fix session still open' }
    ])
    const neu = await decide('tab-and-dirty')
    expect(neu.map((d) => [d.key, d.verdict, failedCheck(d)])).toEqual([
      ['mr:1610', 'skipped', 'No open session']
    ])
  })

  it('stops what the sweep stopped at dispatch when Claude is out of quota', async () => {
    const neu = await decide('quota-out')
    expect(neu.map((d) => [d.key, d.verdict, failedCheck(d)])).toEqual([
      ['mr:1561', 'skipped', 'Quota'],
      ['mr:1574', 'skipped', 'Clean']
    ])
  })
})
