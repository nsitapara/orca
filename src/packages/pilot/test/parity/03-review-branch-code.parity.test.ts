import { mkdtempSync, readdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, it } from 'vitest'
import type { ItemDecision } from '../../src/shared/api-types'
import { loadFixture } from './fixture'
import { JOB_03, PARITY_03_FROZEN, seed03, VERDICTS_03 } from './jobs/job-03'
import { frozenOldPlan, PARITY_DIR, type OldDecision } from './old-side'
import { describeParity, expectParity, parityReport } from './parity-case'
import {
  caseFile,
  dryTick,
  failedCheck,
  loadPortedAutomation,
  runnerQuotaAgrees,
  stoppedBy
} from './ported'
import { withWorktrees } from './worktree-fixture'

const CASES = join(PARITY_DIR, JOB_03.job)
const cases = readdirSync(CASES)
  .filter((f) => f.endsWith('.json'))
  .sort()
const REPO = '400fee61-a463-4f76-894a-39861e906007'
const key = (n: number): string => `wt:${REPO}::/wt/web-${n}`

const QUOTA_OLD = /^(claude|codex) (weekly|session) limit at (\d+)%/
// The Codex check 03 keeps (its orchestrator starts Codex sessions the runner can't see), in the check's words.
const CODEX_CHECK = /^Codex is at (\d+)% of its (weekly|session) limit/

async function decide(name: string): Promise<ItemDecision[]> {
  const { definition, people } = loadPortedAutomation(JOB_03.automationId)
  return dryTick({
    definition,
    people,
    fixture: loadFixture(caseFile(JOB_03.job, name)),
    seed: seed03,
    tickDeps: withWorktrees
  })
}

// Claude's quota is the runner's hold; Codex's is the job's own check.
function quotaAgrees(o: OldDecision, n: ItemDecision): boolean {
  if (runnerQuotaAgrees(o.reason, n.reason)) {
    return n.hold?.code === 'quota'
  }
  const [, agent, window, percent] = QUOTA_OLD.exec(o.reason) ?? []
  const [, newPercent, newWindow] = CODEX_CHECK.exec(n.reason) ?? []
  return agent === 'codex' && window === newWindow && percent === newPercent
}

// gate.evaluate's and review_block's skip reasons, and the check that gives each in Pilot (the MR rules in gate.py's
// own words).
function skipAgrees(o: OldDecision, n: ItemDecision): boolean {
  // Work in flight picks a throwaway now (2026-10-18): the worktree the sweep skipped starts, or waits on a resource.
  if (o.reason.endsWith('; retry next round')) {
    return (
      n.reason === 'All checks pass' || n.hold?.code === 'quota' || n.hold?.code === 'tick_limit'
    )
  }
  if (/^!\d+ (merged|closed)$/.test(o.reason)) {
    return failedCheck(n) === 'Not merged' && n.reason === o.reason
  }
  if (/^!\d+ approved by /.test(o.reason)) {
    return failedCheck(n) === 'Not approved' && n.reason === o.reason
  }
  if (o.reason.startsWith('MR approval unknown: ')) {
    return failedCheck(n) === 'Not approved' && n.reason.startsWith('MR approval unknown: ')
  }
  if (o.reason === 'current cycle still running') {
    return n.reason === `Another run of this job is still active on ${n.label}`
  }
  return false
}

// Whether Pilot's reason is the sweep's, in Pilot's words.
function reasonAgrees(o: OldDecision, n: ItemDecision): boolean {
  switch (o.decision) {
    case 'base':
      return n.reason === 'First time seen: recorded, not acted on'
    case 'nothing_new':
      return n.reason.startsWith('Nothing new since ')
    case 'skip':
      return skipAgrees(o, n)
    case 'QUOTA':
      return quotaAgrees(o, n)
    case 'start':
      return n.reason === 'All checks pass'
    case 'defer':
      // When it starts depends on the live file's switch, which parity doesn't pin.
      return n.reason.startsWith('Over the limit of 2 per tick; starts at ')
    case 'parked':
      return n.reason === `Another run of this job is still active on ${n.label}`
    default:
      return false
  }
}

// loop.py sweep's decisions are frozen in each case (its old block), so neither python3 nor loop.py is needed; skipped,
// with what's missing in its title and on stderr, only where ~/.agents/automations (or PARITY_AUTOMATIONS_DIR) isn't
// there. A case without its old block fails.
describeParity(
  PARITY_03_FROZEN,
  '03 · Review and fix branch code: Pilot decides each worktree as loop.py sweep did (frozen)',
  () => {
    it.each(cases)(
      '%s: the same decision for every worktree, from reads the case holds',
      async (name) => {
        await expectParity(PARITY_03_FROZEN, join(CASES, name))
      }
    )

    it.each(cases)('%s: each worktree is held for the reason the sweep gave', async (name) => {
      const old = frozenOldPlan(join(CASES, name))
      const fresh = await decide(name.replace(/\.json$/, ''))
      for (const o of old) {
        if (VERDICTS_03.known?.some((k) => k.key === o.key && k.word === o.decision)) {
          continue // a deliberate difference, named in VERDICTS_03 with its reason
        }
        const n = fresh.find((d) => d.key === o.key)
        expect(n, o.key).toBeDefined()
        expect([o.key, o.decision, o.reason, reasonAgrees(o, n!)]).toEqual([
          o.key,
          o.decision,
          o.reason,
          true
        ])
      }
      // What the sweep never lists (a teammate's branch, one whose owner GitLab can't name) is out of scope by the owner.
      const listed = new Set(old.map((d) => d.key))
      for (const n of fresh.filter((d) => !listed.has(d.key))) {
        expect([n.key, n.verdict, /^(!\d+ is \S+'s MR|MR owner unknown: )/.test(n.reason)]).toEqual(
          [n.key, 'out_of_scope', true]
        )
      }
    })

    // Review Focus: a runtime check declared before an eligibility check must not hold an ineligible worktree. Work in
    // flight holds nothing (2026-10-18): 323's uncommitted changes don't hold it, Claude's quota does.
    it('checks a worktree for commits and the MR rules first, then holds it for quota, never for work in flight', async () => {
      const fresh = await decide('check-order')
      expect(fresh.map((d) => [d.key, d.verdict, stoppedBy(d)])).toEqual([
        [key(321), 'skipped', 'Not approved'],
        [key(322), 'skipped', 'Not merged'],
        [key(323), 'held', 'quota'],
        [key(324), 'baselined', null],
        [key(325), 'out_of_scope', null],
        [key(326), 'skipped', 'Not approved'],
        [key(327), 'held', 'quota']
      ])
    })

    it('starts two cycles per tick in listing order; the third is held for the limit', async () => {
      const fresh = await decide('two-per-tick')
      expect(fresh.map((d) => [d.key, d.verdict])).toEqual([
        [key(331), 'started'],
        [key(332), 'started'],
        [key(333), 'held']
      ])
    })

    it("keys each due worktree once per head: the once_per key is the item's worktree at its head", async () => {
      const fresh = await decide('gates')
      expect(fresh.find((d) => d.key === key(314))).toMatchObject({
        onceKey: `${REPO}::/wt/web-314@${'f314'.padEnd(40, '0')}` // HEAD is this loop's fix on top of my commit
      })
    })

    it('reviews a branch with no MR yet: it is mine, in scope, and due', async () => {
      const fresh = await decide('no-mr-yet')
      expect(fresh.map((d) => [d.key, d.verdict, d.fields['mr.iid']])).toEqual([
        [key(371), 'started', null]
      ])
    })

    // The ruling for 03: the one deliberate difference is real, and the harness reports it once its entry is gone.
    it('fails the other-agent quota case without its known entry', async () => {
      const file = join(CASES, 'quota-out-other-agent.json')
      const strict = { ...PARITY_03_FROZEN, table: { ...VERDICTS_03, known: [] } }
      expect(await parityReport(strict, loadFixture(file), frozenOldPlan(file))).toBe(
        `${key(342)}: old start: 1 new commit(s) since aaaaaaaaa, claude leads | new held: Codex is at 95% of its weekly limit (stops at 90%)`
      )
    })

    // A teammate's MR is out of scope whatever its approvals say: a case lacking that read agrees on every verdict, and
    // only the missed read fails it.
    it('fails a case when the new side reads what the fixture lacks, though every verdict agrees', async () => {
      const approvals = `GET projects/polygenx%2Fweb-platform/merge_requests/311/approvals`
      const fixture = loadFixture(join(CASES, 'gates.json'))
      fixture.reads = fixture.reads.filter((r) => !(r.argv.at(-1) ?? '').endsWith('/311/approvals'))
      const file = join(mkdtempSync(join(tmpdir(), 'pilot-parity-03-')), 'missing-approvals.json')
      writeFileSync(file, JSON.stringify(fixture))
      expect(await parityReport(PARITY_03_FROZEN, loadFixture(file), frozenOldPlan(file))).toBe(
        `missed read: ${approvals}`
      )
    })
  }
)
