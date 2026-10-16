import { readdirSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import type { PilotStore } from '../../src/main/store/store'
import { decideStep } from '../../src/shared/run/step-plan'
import { loadFixture, type ParityFixture } from './fixture'
import { answerDue, JOB_06, PARITY_06, seed06 } from './jobs/job-06'
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
      missedRunGraceMs: 12 * 3_600_000,
      oncePer: '{mr.iid}:{run.tick}',
      limits: { perTick: 3 },
      powers: ['commit', 'push', 'reply'],
      inbox: '{mr.author}'
    })
    expect(definition.items).toMatchObject({
      kind: 'merge_request',
      match: ['{mr.waiting_threads} > 0']
    })
    // A dirty worktree is no gate: the env's busy check puts the run in a throwaway (pilotcli M4 §8). Commits that
    // wait to be pushed are one (due.sh): the run's push would publish them, so it could only leave another card.
    expect(definition.workspace).toEqual({
      kind: 'env',
      subject: { kind: 'worktree', worktree: '{worktree.path}', at: null },
      writes: true,
      stack: 'when_backend'
    })
    expect(definition.checks).toMatchObject([
      { kind: 'worktree_exists' },
      { kind: 'session_none_open', scope: 'automation' },
      {
        kind: 'script',
        run: '/Users/nishsitapara/.agents/skills/global-command-address-mr-feedback/scripts/due.sh',
        timeoutMs: 60_000
      },
      { kind: 'quota', agent: 'claude', weekly: 90, session: 95 }
    ])
  })

  it('runs the chain: context, flag, catch-up, the agent, push, merge back, replies, card, and two always steps', () => {
    expect(definition.steps.map((s) => [s.name, s.agent, s.mode, s.always, s.when])).toEqual([
      ['context', 'shell', null, false, null],
      ['flag', 'shell', null, true, "{steps.context.outcome} == 'ok'"],
      ['catch_up', 'shell', null, false, null],
      ['address', 'claude', 'feedback', false, null],
      [
        'push',
        'shell',
        null,
        false,
        '{steps.address.head} != null and {steps.context.remote} != null'
      ],
      ['merge_back', 'shell', null, false, "{env.mode} == 'throwaway'"],
      [
        'replies',
        'shell',
        null,
        false,
        "{steps.address.replies} > 0 and {steps.address.head} == null or {steps.address.replies} > 0 and {steps.push.outcome} == 'ok'"
      ],
      ['card', 'shell', null, false, "{steps.push.outcome} != 'ok'"],
      ['forget_branch', 'shell', null, true, "{env.mode} == 'throwaway'"],
      ['forget_replies', 'shell', null, true, null],
      ['flag_failed', 'shell', null, true, '{run.failed} == true']
    ])
    const step = (name: string) => definition.steps.find((s) => s.name === name)!
    expect(step('context').run).toBe('pilotcli skills get-context address-mr-feedback "$IID"')
    expect(step('context').exitCodes).toEqual({ ok: [0], skip: [], stop: [3] })
    expect(step('catch_up').run).toBe(
      'pilotcli git update-branch . --to "origin/$BRANCH" --format text'
    )
    expect(step('catch_up').exitCodes).toEqual({ ok: [0], skip: [3], stop: [] })
    expect(step('flag').env).toEqual({ WT: '{worktree.path}', IID: '{mr.iid}' })
    expect(step('flag').run).toContain(
      '--worktree "path:$WT" --gitlab-mr "!$IID" --comment "addressing MR feedback !$IID (auto)"'
    )
    expect(step('flag_failed').env).toEqual({
      WT: '{worktree.path}',
      IID: '{mr.iid}',
      RUN: '{run.id}'
    })
    expect(step('flag_failed').run).toContain('--worktree "path:$WT" --unread')
    expect(step('address')).toMatchObject({
      skill: SKILL,
      mode: 'feedback',
      promptStyle: 'wrapped'
    })
    for (const placeholder of [
      '{steps.context.result}',
      '{steps.catch_up.status}',
      '{run.id}/replies.jsonl'
    ]) {
      expect(step('address').prompt).toContain(placeholder)
    }
    expect(step('push').run).toBe(
      'pilotcli git push-branch "$BRANCH" --checkout . --expect-sha "$REMOTE" --expect-head "$HEAD_SHA" --from "$FROM"'
    )
    expect(step('push').env).toEqual({
      BRANCH: '{mr.branch}',
      HEAD_SHA: '{steps.address.head}',
      REMOTE: '{steps.context.remote}',
      FROM: '{env.sha}'
    })
    // A refusal is a skip that keeps outcome and reason for the card step.
    expect(step('push').exitCodes).toMatchObject({ ok: [0], skip: [1, 2, 3, 5] })
    expect(step('replies').run).toBe(
      'pilotcli gitlab reply-thread --mr "$IID" --input "$REPLIES" --keep-going true'
    )
    expect(step('replies').env.REPLIES).toBe(
      '/Users/nishsitapara/Library/Caches/pilot-replies/{run.id}/replies.jsonl'
    )
    expect(step('card').run).toBe(
      'pilotcli inbox create-card --push "$IID" --worktree "$HOME_WT" --contains "$HEAD_SHA" --context "$SUMMARY Not pushed: $WHY. $AFTER"'
    )
    expect(step('card').env).toEqual({
      IID: '{mr.iid}',
      HEAD_SHA: '{steps.address.head}',
      SUMMARY: '{steps.address.summary}',
      WHY: '{steps.push.reason}',
      HOME_WT: '{worktree.path}',
      AFTER: expect.stringContaining('wait for this push')
    })
    expect(step('forget_branch')).toMatchObject({
      always: true,
      run: 'pilotcli git delete-branch "$KEEP_BRANCH" --kept-in "$HOME_WT" --pushed-to "$BRANCH"',
      exitCodes: { ok: [0], skip: [3] },
      timeoutMs: 2 * 60_000
    })
    expect(step('forget_replies')).toMatchObject({
      run: 'rm -rf "$DIR"',
      env: { DIR: '/Users/nishsitapara/Library/Caches/pilot-replies/{run.id}' }
    })
  })

  it('posts replies once the commits are on origin, or at once with none; a refused push leaves them for later', () => {
    const step = (name: string) => definition.steps.find((s) => s.name === name)!
    const done = [{ name: 'merge_back', status: 'skipped' as const, always: false, error: null }]
    const cases: [string, Record<string, unknown>, boolean, boolean][] = [
      // (what, fields, replies run, card runs)
      [
        'pushed',
        { 'steps.address.replies': 2, 'steps.address.head': 'a', 'steps.push.outcome': 'ok' },
        true,
        false
      ],
      ['nothing to push', { 'steps.address.replies': 1 }, true, false],
      [
        'a refused push',
        { 'steps.address.replies': 2, 'steps.address.head': 'a', 'steps.push.outcome': 'skip' },
        false,
        true
      ],
      [
        'no replies, pushed',
        { 'steps.address.replies': 0, 'steps.address.head': 'a', 'steps.push.outcome': 'ok' },
        false,
        false
      ]
    ]
    for (const [what, fields, replies, card] of cases) {
      expect([what, decideStep(step('replies'), done, fields as never).run]).toEqual([
        what,
        replies
      ])
      expect([what, decideStep(step('card'), done, fields as never).run]).toEqual([what, card])
    }
    const failed = [{ name: 'address', status: 'failed' as const, always: false, error: 'x' }]
    expect(decideStep(step('forget_replies'), failed, {})).toEqual({ run: true })
  })

  it('still addresses feedback when the flag hangs, and flags a failed or timed-out run', () => {
    const [context, flag, catchUp, address] = definition.steps
    const flagFailed = definition.steps.find((s) => s.name === 'flag_failed')!
    const timedOut = [
      { name: context.name, status: 'done' as const, always: false, error: null },
      { name: flag.name, status: 'timed_out' as const, always: flag.always, error: null },
      { name: catchUp.name, status: 'done' as const, always: false, error: null }
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
      ['head', 'summary', 'replies'],
      ['outcome', 'item_status', 'reply']
    ])
    expect(modeText('answers')).toContain('**Never push.**')
    expect(modeText('feedback')).toContain(
      `apply them as \`~/.agents/skills/${SKILL}/modes/answers.md\``
    )
    // D1: its default, flagged and question items are plain cards, answerable at once, posted with pilotcli inbox create-card.
    expect(modeText('feedback')).toContain(
      'pilotcli inbox create-card --kind <default|flagged|question>'
    )
    expect(modeText('feedback')).toContain('as a plain card')
    expect(modeText('feedback')).not.toContain('--evidence')
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
      seed: seed06,
      runScript: answerDue
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

  it('gates: the dirty worktree now starts too, so three start and two are over the limit', async () => {
    const neu = await decide('gates')
    expect(neu.filter((d) => d.verdict === 'started').map((d) => d.key)).toEqual([
      'mr:1712',
      'mr:1713',
      'mr:1714'
    ])
    expect(neu.filter((d) => d.verdict === 'over_limit').map((d) => d.key)).toEqual([
      'mr:1715',
      'mr:1716'
    ])
    expect(neu.filter((d) => d.verdict === 'skipped').map((d) => [d.key, failedCheck(d)])).toEqual([
      ['mr:1710', 'Worktree'],
      ['mr:1711', 'No open session']
    ])
    const spent = await decide('quota-out')
    expect(failedCheck(spent.find((d) => d.key === 'mr:1720'))).toBe('Quota')
    expect(spent.find((d) => d.key === 'mr:1721')?.verdict).toBe('out_of_scope')
  })

  // The ruling for 05/06: skip reasons, not only verdicts, on every case. The sweep's skip for a dirty worktree or a
  // git operation is gone: the env's busy check replaces that gate (pilotcli M4 §8), so no check names it.
  it.each(cases)("%s: each skip is for the check that names the sweep's reason", async (name) => {
    const byReason: [RegExp, string][] = [
      [/^no Orca worktree$/, 'Worktree'],
      [/^previous feedback session still open/, 'No open session'],
      [/^claude .*(weekly|session)/, 'Quota']
    ]
    const busy = /^(uncommitted changes|\S+ present); retry next round$/
    const neu = await decide(name.replace(/\.json$/, ''))
    const old = runOldPlan('06', join(CASES, name)).filter(
      (d) => d.decision === 'skip' || d.decision === 'quota'
    )
    for (const d of old) {
      const fresh = neu.find((n) => n.key === d.key)
      if (busy.test(d.reason)) {
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
      earlier = store.startTick(JOB_06.automationId, f.now - 3_600_000)
      store.markHandled(
        JOB_06.automationId,
        `1711:${earlier}`,
        'mr-feedback-earlier',
        f.now - 3_600_000
      )
    }
    const after = await dryTick({ definition, people, fixture: closed, seed, runScript: answerDue })
    const decision = after.find((d) => d.key === 'mr:1711')
    expect(decision).toMatchObject({ verdict: 'started' })
    expect(decision?.onceKey).not.toBe(`1711:${earlier}`)
  })
})
