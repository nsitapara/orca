import { mkdtempSync, readdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, it } from 'vitest'
import { loadFixture } from './fixture'
import { JOB_05, PARITY_05, load05, seed05 } from './jobs/job-05'
import { frozenOldPlan, PARITY_DIR } from './old-side'
import { caseFile, dryTick, failedCheck } from './ported'
import { describeParity, expectParity, parityReport } from './parity-case'

const CASES = join(PARITY_DIR, '05')
const SYNTHETIC = join(CASES, 'synthetic-basic.json')
const cases = readdirSync(CASES)
  .filter((f) => f.endsWith('.json'))
  .sort()

// ci-fix-sweep's decisions are frozen in each case (its old block), so neither python3 nor the sweep is needed; skipped,
// with what's missing in its title and on stderr, only where ~/.agents/automations (or PARITY_AUTOMATIONS_DIR) isn't
// there. A case without its old block fails.
describeParity(PARITY_05, '05 · Fix failed CI: Pilot decides each MR as ci-fix-sweep did', () => {
  it("holds ci-fix-sweep's decisions on the synthetic case", () => {
    const decided = frozenOldPlan(SYNTHETIC).map((d) => [d.key, d.decision, d.reason])
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

  // !105 is dirty: the sweep skips it, and the env's busy check replaces that gate (pilotcli M4 §8), so Pilot
  // starts it. Both verdicts agree under the table, whatever its git-operation markers say: a case lacking one
  // of them agrees on every verdict, and only the missed read fails it.
  it('fails a case when the new side reads what the fixture lacks, though every verdict agrees', async () => {
    const marker = ['git', '-C', '/tmp/parity-05/wt-105', 'rev-parse', '--git-path', 'MERGE_HEAD']
    const fixture = loadFixture(SYNTHETIC)
    fixture.reads = fixture.reads.filter((r) => r.argv.join(' ') !== marker.join(' '))
    const file = join(mkdtempSync(join(tmpdir(), 'pilot-parity-')), 'missing-marker.json')
    writeFileSync(file, JSON.stringify(fixture))
    expect(await parityReport(PARITY_05, loadFixture(file), frozenOldPlan(file))).toBe(
      `missed read: ${marker.join(' ')}`
    )
    await expect(expectParity(PARITY_05, file)).rejects.toMatchObject({
      actual: `missed read: ${marker.join(' ')}`
    })
  })
})

const RECORDED = '2026-10-10-1210'

// Task 38b: the same cases with the sweep's state in the store (seed05: its handled.json keys and its tabs).
describeParity(PARITY_05, "05 · Fix failed CI v2: with the sweep's state", () => {
  const { def, people } = load05()
  const decide = (name: string) =>
    dryTick({
      definition: def,
      people,
      fixture: loadFixture(caseFile(JOB_05.job, name)),
      seed: seed05
    })

  it("never retries a pipeline the sweep's handled.json names", async () => {
    const neu = await decide(RECORDED)
    expect(neu.find((d) => d.key === 'mr:1587')).toMatchObject({
      verdict: 'notdue',
      onceKey: '1587:2933991087'
    })
  })

  it('starts the first three MRs the sweep started, skips with the check it named, and caps the fourth', async () => {
    const neu = await decide(RECORDED)
    expect(neu.filter((d) => d.verdict === 'started').map((d) => d.key)).toEqual([
      'mr:1561',
      'mr:1574',
      'mr:1592'
    ])
    expect(neu.find((d) => d.key === 'mr:1607')?.verdict).toBe('over_limit')
    const skipped = neu.filter((d) => d.verdict === 'skipped').map((d) => [d.key, failedCheck(d)])
    expect(skipped).toEqual([['mr:1601', 'Worktree']])
    // The sweep skipped 1574 (dirty), 1592 (tab open), 1603 and 1604 (dirty, mid-rebase); the env's busy check
    // replaces those gates (pilotcli M4 §8), so 1574 and 1592 start and the rest wait for the limit.
    expect(neu.filter((d) => d.verdict === 'over_limit').map((d) => d.key)).toEqual([
      'mr:1603',
      'mr:1604',
      'mr:1605',
      'mr:1606',
      'mr:1607'
    ])
  })

  // The ruling for 05: skip reasons, not only verdicts, on every case. The sweep's skips for a dirty worktree, a
  // git operation or an open tab are gone: the env's busy check replaces those gates (pilotcli M4 §8), so such an
  // MR is never skipped and no check names them.
  it.each(cases)(
    "%s: each MR is skipped for the check that names the sweep's reason",
    async (name) => {
      const byReason: [RegExp, string][] = [
        [/^no Orca worktree$/, 'Worktree'],
        [/^claude .*(weekly|session)/, 'Quota']
      ]
      const neu = await decide(name.replace(/\.json$/, ''))
      const old = frozenOldPlan(join(CASES, name)).filter(
        (d) => d.decision === 'skip' || d.decision === 'quota'
      )
      const busy =
        /^(uncommitted changes|\S+ present); retry next round$|^previous CI-fix session still open$/
      for (const d of old) {
        const fresh = neu.find((n) => n.key === d.key)
        if (busy.test(d.reason)) {
          // Never skipped for the sweep's reason: started, over the limit, or (quota-out) held by the quota check.
          const held = fresh?.verdict === 'skipped'
          expect([d.key, d.reason, held ? failedCheck(fresh) : fresh?.verdict]).toEqual([
            d.key,
            d.reason,
            held ? 'Quota' : expect.stringMatching(/^(started|over_limit)$/)
          ])
          continue
        }
        const expected = byReason.find(([re]) => re.test(d.reason))?.[1]
        expect([d.key, d.reason, failedCheck(fresh)]).toEqual([d.key, d.reason, expected])
      }
    }
  )

  // The sweep tested the open tab first, then the dirty worktree. The env's busy check replaces both gates
  // (pilotcli M4 §8): the MR is started, in a throwaway when something is working there.
  it('starts an MR with an open tab and a dirty worktree, where the sweep skipped it for the open tab', async () => {
    const old = frozenOldPlan(caseFile(JOB_05.job, 'tab-and-dirty'))
    expect(old).toMatchObject([
      { key: 'mr:1610', decision: 'skip', reason: 'previous CI-fix session still open' }
    ])
    const neu = await decide('tab-and-dirty')
    expect(neu.map((d) => [d.key, d.verdict, failedCheck(d)])).toEqual([
      ['mr:1610', 'started', null]
    ])
  })

  it('stops what the sweep stopped at dispatch when Claude is out of quota', async () => {
    const neu = await decide('quota-out')
    expect(neu.map((d) => [d.key, d.verdict, failedCheck(d)])).toEqual([
      ['mr:1561', 'skipped', 'Quota'],
      ['mr:1574', 'skipped', 'Quota']
    ])
  })
})
