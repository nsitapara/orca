import { readdirSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import type { PilotStore } from '../../src/main/store/store'
import { decideStep } from '../../src/shared/run/step-plan'
import { loadFixture, type ParityFixture } from './fixture'
import { JOB_06, PARITY_06, seed06 } from './jobs/job-06'
import { PARITY_DIR, runOldPlan } from './old-side'
import { describeParity, expectParity } from './parity-case'
import { caseFile, dryTick, failedCheck, loadPortedAutomation } from './ported'

const JOB = 'mr-feedback'
const SKILL = 'global-command-address-mr-feedback'
const { definition, people } = loadPortedAutomation(JOB)

function modeText(mode: string): string {
  return readFileSync(join(homedir(), '.agents', 'skills', SKILL, 'modes', `${mode}.md`), 'utf8')
}

function modeOutputs(mode: string): string[] {
  const front = /^---\n([\s\S]*?)\n---\n/.exec(modeText(mode))?.[1] ?? ''
  const list = /^outputs: \[(.*)\]$/m.exec(front)?.[1] ?? ''
  return list
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
}

describe('06 · Address reviewer feedback: the definition', () => {
  it('looks at my open MRs with a thread waiting on me, keyed afresh every tick like the sweep', () => {
    expect(definition).toMatchObject({
      name: '06 · Address reviewer feedback on my MRs',
      schedule: '40 * * * *',
      enabled: false,
      missedRunGraceMs: 12 * 3_600_000,
      oncePer: '{mr.iid}:{run.tick}',
      limits: { perTick: 3 },
      workspace: { kind: 'item_worktree' },
      powers: ['commit', 'push', 'reply'],
      inbox: '{mr.author}'
    })
    expect(definition.items).toMatchObject({
      kind: 'merge_request',
      match: ['{mr.waiting_threads} > 0']
    })
    expect(definition.checks).toEqual([
      { kind: 'worktree_exists' },
      { kind: 'session_none_open', scope: 'automation' },
      { kind: 'worktree_clean' },
      { kind: 'quota', agent: 'claude', weekly: 90, session: 95 }
    ])
  })

  it('flags the worktree around the feedback run through env, and only flags a failed run', () => {
    expect(definition.steps.map((s) => [s.name, s.agent, s.mode, s.always, s.when])).toEqual([
      ['flag', 'shell', null, true, null],
      ['address', 'claude', 'feedback', false, null],
      ['flag_failed', 'shell', null, true, '{run.failed} == true']
    ])
    const [flag, address, flagFailed] = definition.steps
    expect(flag.env).toEqual({ WT: '{worktree.path}', IID: '{mr.iid}' })
    expect(flag.run).toContain(
      '--worktree "path:$WT" --gitlab-mr "!$IID" --comment "addressing MR feedback !$IID (auto)"'
    )
    expect(flag.run).toContain('|| echo')
    expect(flagFailed.env).toEqual({ WT: '{worktree.path}', IID: '{mr.iid}', RUN: '{run.id}' })
    expect(flagFailed.run).toContain('--worktree "path:$WT" --unread')
    expect(flagFailed.run).toContain('|| echo')
    expect(address).toMatchObject({ skill: SKILL, mode: 'feedback', promptStyle: 'wrapped' })
  })

  it('still addresses feedback when the flag hangs, and flags a failed or timed-out run', () => {
    const [flag, address, flagFailed] = definition.steps
    const timedOut = [
      { name: 'flag', status: 'timed_out' as const, always: flag.always, error: null }
    ]
    expect(decideStep(address, timedOut, {})).toEqual({ run: true })
    const addressTimedOut = [
      ...timedOut,
      { name: 'address', status: 'timed_out' as const, always: false, error: null }
    ]
    expect(decideStep(flagFailed, addressTimedOut, { 'run.failed': true })).toEqual({ run: true })
    expect(decideStep(flagFailed, timedOut, { 'run.failed': false })).toMatchObject({ run: false })
  })

  it("sends my answers back to the asking session, else to the skill's answers mode, which re-checks and never pushes blind", () => {
    expect(definition.answers).toEqual({
      resume: 'asking_session',
      else: { agent: 'claude', skill: SKILL, mode: 'answers' }
    })
    expect([modeOutputs('feedback'), modeOutputs('answers')]).toEqual([
      [],
      ['outcome', 'item_status', 'reply']
    ])
    expect(modeText('feedback')).toContain(
      `apply them as \`~/.agents/skills/${SKILL}/modes/answers.md\``
    )
    // D1: its default, flagged and question items are plain cards, answerable at once.
    expect(modeText('feedback')).toContain('pilot inbox add --type <default|flagged|question>')
    expect(modeText('feedback')).not.toContain('context.py enqueue')
    expect(modeText('answers')).toContain('item_status=stale')
  })
})

// mr-feedback-sweep's words (jobs/job_06.py) and the verdicts that agree with them, through the shared parity runner
// (parity-case.ts): a missed read, a tick error or a verdict mismatch fails a case.
const CASES = join(PARITY_DIR, '06')
const cases = readdirSync(CASES)
  .filter((f) => f.endsWith('.json'))
  .sort()

describeParity(PARITY_06, '06 · Address reviewer feedback: parity with mr-feedback-sweep', () => {
  const decide = (name: string, fixture?: ParityFixture) =>
    dryTick({
      definition,
      people,
      fixture: fixture ?? loadFixture(caseFile(JOB_06.job, name)),
      seed: seed06
    })

  it.each(cases)(
    '%s: every MR gets the verdict the sweep gave it, from reads the case holds',
    async (name) => {
      await expectParity(PARITY_06, join(CASES, name))
    }
  )

  it('threads: only the MRs waiting() counts are started; the rest are out of scope for the match', async () => {
    const neu = await decide('threads')
    expect(neu.filter((d) => d.verdict === 'started').map((d) => d.key)).toEqual([
      'mr:1700',
      'mr:1704'
    ])
    const out = neu.filter((d) => d.verdict === 'out_of_scope')
    expect(out.map((d) => d.key)).toEqual(['mr:1701', 'mr:1702', 'mr:1703', 'mr:1705', 'mr:1706'])
    for (const d of out) {
      expect(d.reason).toContain('waiting_threads')
    }
  })

  it('gates: three start, the fourth is over the limit, and each skip names the sweep’s gate', async () => {
    const neu = await decide('gates')
    expect(neu.filter((d) => d.verdict === 'started').map((d) => d.key)).toEqual([
      'mr:1713',
      'mr:1714',
      'mr:1715'
    ])
    expect(neu.find((d) => d.key === 'mr:1716')?.verdict).toBe('over_limit')
    expect(neu.filter((d) => d.verdict === 'skipped').map((d) => [d.key, failedCheck(d)])).toEqual([
      ['mr:1710', 'Worktree'],
      ['mr:1711', 'No open session'],
      ['mr:1712', 'Clean']
    ])
    const spent = await decide('quota-out')
    expect(failedCheck(spent.find((d) => d.key === 'mr:1720'))).toBe('Quota')
    expect(spent.find((d) => d.key === 'mr:1721')?.verdict).toBe('out_of_scope')
  })

  // The ruling for 05/06: skip reasons, not only verdicts, on every case.
  it.each(cases)("%s: each skip is for the check that names the sweep's reason", async (name) => {
    const byReason: [RegExp, string][] = [
      [/^no Orca worktree$/, 'Worktree'],
      [/^previous feedback session still open/, 'No open session'],
      [/^(uncommitted changes|\S+ present); retry next round$/, 'Clean'],
      [/^claude .*(weekly|session)/, 'Quota']
    ]
    const neu = await decide(name.replace(/\.json$/, ''))
    const old = runOldPlan('06', join(CASES, name)).filter(
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
  })

  // The sweep tests the open tab before the dirty worktree.
  it('skips an MR with an open tab and a dirty worktree for the open tab, as the sweep does', async () => {
    expect(runOldPlan('06', caseFile(JOB_06.job, 'tab-and-dirty'))).toMatchObject([
      {
        key: 'mr:1730',
        decision: 'skip',
        reason: expect.stringContaining('previous feedback session still open')
      }
    ])
    const neu = await decide('tab-and-dirty')
    expect(neu.map((d) => [d.key, d.verdict, failedCheck(d)])).toEqual([
      ['mr:1730', 'skipped', 'No open session']
    ])
  })

  it('re-dispatches a still-waiting MR once its tab closes, never remembering it as handled', async () => {
    const open = loadFixture(caseFile(JOB_06.job, 'gates'))
    const before = await decide('gates', open)
    expect(before.find((d) => d.key === 'mr:1711')).toMatchObject({ verdict: 'skipped' })

    // The tab closes: its terminal is no longer connected. The tick before this one started a run for the MR,
    // under that tick's key.
    const closed: ParityFixture = {
      ...open,
      reads: open.reads.map((r) =>
        r.argv.join(' ') === 'orca terminal list --json'
          ? { ...r, json: { ok: true, result: { terminals: [] } } }
          : r
      )
    }
    let earlier = 0
    const seed = (store: PilotStore, f: ParityFixture) => {
      seed06(store, f)
      earlier = store.startTick(JOB_06.automationId, false, f.now - 3_600_000)
      store.markHandled(
        JOB_06.automationId,
        `1711:${earlier}`,
        'mr-feedback-earlier',
        f.now - 3_600_000
      )
    }
    const after = await dryTick({ definition, people, fixture: closed, seed })
    const decision = after.find((d) => d.key === 'mr:1711')
    expect(decision).toMatchObject({ verdict: 'started' })
    expect(decision?.onceKey).not.toBe(`1711:${earlier}`)
  })
})
