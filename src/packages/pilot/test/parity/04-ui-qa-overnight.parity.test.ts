import { readdirSync } from 'node:fs'
import { join } from 'node:path'
import { expect, it } from 'vitest'
import type { ItemDecision } from '../../src/shared/api-types'
import { loadFixture } from './fixture'
import { JOB_04, PARITY_04, seed04, VERDICTS_04 } from './jobs/job-04'
import { frozenOldPlan, PARITY_DIR, type OldDecision } from './old-side'
import { describeParity, expectParity, parityReport } from './parity-case'
import { caseFile, dryTick, failedCheck, loadPortedAutomation, runnerQuotaAgrees } from './ported'

const CASES = join(PARITY_DIR, JOB_04.job)
const REPO = '400fee61-a463-4f76-894a-39861e906007'
const key = (n: number): string => `wt:${REPO}::/wt/web-${n}`
const GIT_OPERATION = 'A merge, rebase or git lock is in progress; retry next tick'
const BUSY = /^(someone is typing in .+|.+ (is working|is asking for input|could not be read))$/

// The runner's hold on Codex's quota (runner-gates.ts): the job declares no quota of its own.
const CODEX_HOLD = /^codex (weekly|session) limit at \d+% \(jobs stop at \d+%\)$/

function cases(): string[] {
  try {
    return readdirSync(CASES)
      .filter((f) => f.endsWith('.json'))
      .sort()
  } catch {
    return []
  }
}

async function decide(name: string): Promise<ItemDecision[]> {
  const { definition, people } = loadPortedAutomation(JOB_04.automationId)
  return dryTick({
    definition,
    people,
    fixture: loadFixture(caseFile(JOB_04.job, name)),
    seed: seed04,
    tickDeps: PARITY_04.tickDeps
  })
}

function quotaAgrees(o: OldDecision, n: ItemDecision): boolean {
  return n.hold?.code === 'quota' && runnerQuotaAgrees(o.reason, n.reason)
}

// The runner's retry gate holds a failed head before the job's checks.
const RETRY = /^Retry \d+ of \d+ at \d\d:\d\d\. Last run failed/

// due.decide's and plan()'s skip reasons, and the check that gives each in Pilot (the MR rules in gate.py's own words).
function skipAgrees(o: OldDecision, n: ItemDecision): boolean {
  if (o.reason.endsWith('; retry next night')) {
    return n.hold?.code === 'retry' && RETRY.test(n.reason)
  }
  if (/^\S+ present$/.test(o.reason)) {
    return failedCheck(n) === '{worktree.git_operation} == null' && n.reason === GIT_OPERATION
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
  if (o.reason === 'automatic UI QA fixes are running') {
    return (
      (failedCheck(n) === 'Idle' && BUSY.test(n.reason)) ||
      n.reason === `Another run is active in ${String(n.fields['worktree.path'])}`
    )
  }
  // A failed head waits out its retry first; the sweep looked at answers and agents first. Nothing starts either way.
  if (o.reason === 'answers are being applied or an agent is working there; QA waits') {
    return (
      (failedCheck(n) === 'No pending answers' && n.reason.endsWith(' waiting to be applied')) ||
      (failedCheck(n) === 'Idle' && BUSY.test(n.reason)) ||
      (n.hold?.code === 'retry' && RETRY.test(n.reason))
    )
  }
  return false
}

// Whether Pilot's reason is the sweep's, in Pilot's words.
function reasonAgrees(o: OldDecision, n: ItemDecision): boolean {
  switch (o.decision) {
    case 'baseline':
      return n.reason === 'First time seen: recorded, not acted on'
    case 'idle':
      return n.reason === o.reason.replace(/^nothing/, 'Nothing')
    case 'skip':
      return skipAgrees(o, n)
    case 'start':
      return n.reason === 'All checks pass'
    // Pilot holds every due worktree on Codex's quota; the sweep tried only the first one it would start and queued the
    // rest. Nothing starts either way.
    case 'queued':
      return (
        n.reason.startsWith('Over the limit of 1 per tick; starts at ') ||
        (n.hold?.code === 'quota' && CODEX_HOLD.test(n.reason))
      )
    case 'held':
      return n.reason === 'At most 1 at once'
    case 'held_active':
      return n.reason === `Already handled ${n.onceKey}`
    case 'outside':
      return (
        failedCheck(n) === 'Window 02:00-05:59' &&
        /^Outside 02:00-05:59 \(now \d\d:\d\d\)$/.test(n.reason)
      )
    case 'QUOTA':
      return quotaAgrees(o, n)
    default:
      return false
  }
}

// loop.py sweep's decisions are frozen in each case (its old block), so neither python3 nor loop.py is needed; skipped,
// with what's missing in its title and on stderr, only where ~/.agents/automations (or PARITY_AUTOMATIONS_DIR) isn't
// there. A case without its old block fails.
describeParity(
  PARITY_04,
  '04 · Test branch UIs overnight: Pilot decides each worktree as loop.py sweep did (frozen)',
  () => {
    it('has its cases', () => {
      expect(cases()).toEqual([
        'check-order.json',
        'failed-first-sight.json',
        'first-sight.json',
        'fixer-holds-the-slot.json',
        'gates.json',
        'holds.json',
        'outside-window.json',
        'quota-out.json',
        'running-run.json'
      ])
    })

    it.each(cases())(
      '%s: the same decision for every worktree, from reads the case holds',
      async (name) => {
        await expectParity(PARITY_04, join(CASES, name))
      }
    )

    it.each(cases())('%s: each worktree is held for the reason the sweep gave', async (name) => {
      const old = frozenOldPlan(join(CASES, name))
      const fresh = await decide(name.replace(/\.json$/, ''))
      for (const o of old) {
        if (VERDICTS_04.known?.some((k) => k.key === o.key && k.word === o.decision)) {
          continue // a deliberate difference, named in VERDICTS_04 with its reason
        }
        const n = fresh.find((d) => d.key === o.key)
        expect(n, o.key).toBeDefined()
        expect([o.key, o.decision, o.reason, n!.reason, reasonAgrees(o, n!)]).toEqual([
          o.key,
          o.decision,
          o.reason,
          n!.reason,
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

    it('starts the longest-waiting due worktree; the next waits a tick', async () => {
      const fresh = await decide('first-sight')
      expect(fresh.map((d) => [d.key, d.verdict])).toEqual([
        [key(401), 'started'],
        [key(402), 'baselined'],
        [key(403), 'baselined'],
        [key(404), 'held'],
        [key(405), 'baselined']
      ])
      expect(fresh[0].onceKey).toBe(`${REPO}::/wt/web-401@${'c401'.padEnd(40, '0')}`)
      const gates = await decide('gates')
      expect(gates.filter((d) => d.verdict === 'started').map((d) => d.key)).toEqual([key(424)])
    })

    // The import end to end: a first sight whose run failed in the old app waits in the runner's line 12 hours from
    // that failure, and is tested after; the failed head is never Pilot's marker, so it stays a first sight.
    it('holds an imported failed first sight for 12 hours, then starts it', async () => {
      const fresh = await decide('failed-first-sight')
      expect(fresh.map((d) => [d.key, d.verdict, d.fields['worktree.first_sight']])).toEqual([
        [key(491), 'held', true],
        [key(492), 'started', true]
      ])
      expect(fresh[0].reason).toBe('Retry 1 of 2 at 14:00. Last run failed')
      expect(fresh[1].onceKey).toBe(`${REPO}::/wt/web-492@${'c492'.padEnd(40, '0')}`)
    })

    it("checks a worktree in the sweep's order: git operation, the MR rules, answers, agents, the window, then quota", async () => {
      const fresh = await decide('check-order')
      expect(fresh.map((d) => [d.key, d.verdict, failedCheck(d)])).toEqual([
        [key(481), 'skipped', '{worktree.git_operation} == null'],
        [key(482), 'skipped', 'Not merged'],
        [key(483), 'skipped', 'Not approved'],
        // Held by its retry; the runtime check that would hold it next is still listed.
        [key(484), 'held', 'No pending answers'],
        [key(485), 'out_of_scope', null],
        [key(486), 'baselined', null],
        [key(487), 'out_of_scope', null],
        [key(488), 'held', 'No pending answers']
      ])
      const late = await decide('outside-window')
      expect(late.map((d) => [d.key, d.verdict, failedCheck(d)])).toEqual([
        [key(441), 'held', 'Window 02:00-05:59'],
        [key(442), 'held', 'Window 02:00-05:59'],
        [key(443), 'held', 'No pending answers']
      ])
    })

    // Every deliberate difference is real: without its entry, its case reports exactly that worktree.
    it.each(VERDICTS_04.known!.map((k) => [k.key, k] as const))(
      'fails %s without its known entry',
      async (_key, known) => {
        const name = cases().find((c) =>
          JSON.stringify(loadFixture(join(CASES, c)).reads).includes(
            known.key.replace(`wt:${REPO}::`, '')
          )
        )!
        const file = join(CASES, name)
        const strict = {
          ...PARITY_04,
          table: { ...VERDICTS_04, known: VERDICTS_04.known!.filter((k) => k !== known) }
        }
        const report = await parityReport(strict, loadFixture(file), frozenOldPlan(file))
        expect(report.split('\n').map((line) => line.slice(0, line.indexOf(': old ')))).toEqual([
          known.key
        ])
        expect(report).toContain(`old ${known.word}`)
        expect(report).toContain(`new ${known.verdict}`)
      }
    )
  }
)
