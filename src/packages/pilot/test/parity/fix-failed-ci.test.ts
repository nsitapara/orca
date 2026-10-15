import { readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { decideStep } from '../../src/shared/run/step-plan'
import { loadPortedAutomation } from './ported'

const JOB = 'fix-failed-ci'
const { definition } = loadPortedAutomation(JOB)

function modeOutputs(skill: string, mode: string): string[] {
  const text = readFileSync(
    join(homedir(), '.agents', 'skills', skill, 'modes', `${mode}.md`),
    'utf8'
  )
  const front = /^---\n([\s\S]*?)\n---\n/.exec(text)?.[1] ?? ''
  const list = /^outputs: \[(.*)\]$/m.exec(front)?.[1] ?? ''
  return list
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
}

describe('05 · Fix failed CI v2: the definition', () => {
  it("keeps the sweep's items, once-per pipeline, limit and checks, in the sweep's order", () => {
    expect(definition).toMatchObject({
      name: '05 · Fix failed CI on my MRs',
      schedule: '10 * * * *',
      enabled: true, // live since go-live stage B (2026-10-14)
      missedRunGraceMs: 12 * 3_600_000,
      oncePer: '{mr.iid}:{mr.pipeline}',
      limits: { perTick: 3 },
      powers: ['commit', 'push'],
      inbox: '{mr.author}'
    })
    // A busy or dirty worktree is no gate: the env's busy check puts the run in a throwaway (pilotcli M4 §8).
    expect(definition.workspace).toEqual({
      kind: 'env',
      subject: { kind: 'worktree', worktree: '{worktree.path}', at: null },
      writes: true,
      stack: 'when_backend'
    })
    expect(definition.items).toMatchObject({ kind: 'merge_request' })
    expect(definition.checks).toEqual([
      { kind: 'worktree_exists' },
      { kind: 'quota', agent: 'claude', weekly: 90, session: 95 }
    ])
  })

  it('runs the chain: context, flag, catch-up, the fix, push, merge back, card, and a flag on failure', () => {
    expect(definition.steps.map((s) => [s.name, s.agent, s.always, s.when])).toEqual([
      ['context', 'shell', false, null],
      ['flag', 'shell', true, "{steps.context.outcome} == 'ok'"],
      ['catch_up', 'shell', false, null],
      ['fix', 'claude', false, null],
      [
        'push',
        'shell',
        false,
        '{steps.fix.head} != null and {steps.context.remote} != null and {steps.context.unpushed} != null'
      ],
      ['merge_back', 'shell', false, "{env.mode} == 'throwaway'"],
      ['card', 'shell', false, '{steps.push.pushed} == false'],
      ['flag_failed', 'shell', true, '{run.failed} == true']
    ])
    expect(definition.steps[1].run).toContain(
      '--gitlab-mr "!$IID" --comment "fixing failed CI !$IID (auto)"'
    )
    expect(definition.steps[1].run).toContain('|| echo')
    expect(definition.steps[7].run).toContain('--unread')
    expect(definition.steps[3]).toMatchObject({
      skill: 'fix-gitlab-ci',
      mode: 'fix',
      promptStyle: 'wrapped'
    })
    for (const placeholder of [
      '{env.path}',
      '{env.mode}',
      '{worktree.path}',
      '{steps.catch_up.status}',
      '{steps.context.result}'
    ]) {
      expect(definition.steps[3].prompt).toContain(placeholder)
    }
  })

  it('gathers the context first: nothing to fix ends the run before the flag and the agent', () => {
    const [context, flag, , fix] = definition.steps
    expect(context.run).toBe('pilotcli skills get-context fix-gitlab-ci "$IID"')
    expect(context.env).toEqual({ IID: '{mr.iid}' })
    expect(context.exitCodes).toEqual({ ok: [0], skip: [], stop: [3] })
    const stopped = [{ name: 'context', status: 'stopped' as const, always: false, error: null }]
    expect(decideStep(flag, stopped, { 'steps.context.outcome': 'skip' })).toMatchObject({
      run: false
    })
    expect(decideStep(fix, stopped, {})).toMatchObject({ run: false })
    const found = [{ name: 'context', status: 'done' as const, always: false, error: null }]
    expect(decideStep(flag, found, { 'steps.context.outcome': 'ok' })).toEqual({ run: true })
  })

  it('catches up with origin before the fix; no fast-forward is a skip the agent turns into a question', () => {
    const catchUp = definition.steps[2]
    // In place or a throwaway's detached HEAD alike (pilotcli 6cc75c3).
    expect(catchUp.run).toBe('pilotcli git update-branch . --to "origin/$BRANCH" --format text')
    expect(catchUp.exitCodes).toEqual({ ok: [0], skip: [3], stop: [] })
  })

  it("pushes the agent's commit pinned, only when it handed one over, else leaves a push card", () => {
    const [, , , , push, , card] = definition.steps
    expect(push.run).toBe(
      'python3 /Users/nishsitapara/.agents/skills/worktree-gate/publish.py push'
    )
    expect(push.env).toMatchObject({
      HEAD_SHA: '{steps.fix.head}',
      REMOTE: '{steps.context.remote}',
      UNPUSHED: '{steps.context.unpushed}',
      MODE: '{env.mode}'
    })
    expect(card.run).toBe(
      'python3 /Users/nishsitapara/.agents/skills/worktree-gate/publish.py card'
    )
    expect(card.env).toMatchObject({
      SUMMARY: '{steps.fix.summary}',
      WHY: '{steps.push.why}',
      BACK: '{steps.merge_back.status}'
    })
    const fixed = { 'steps.context.remote': 'b'.repeat(40), 'steps.context.unpushed': 0 }
    expect(decideStep(push, [], { ...fixed, 'steps.fix.head': 'a'.repeat(40) })).toEqual({
      run: true
    })
    expect(decideStep(push, [], fixed)).toMatchObject({ run: false })
    const mergedOrSkipped = [
      { name: 'merge_back', status: 'skipped' as const, always: false, error: null }
    ]
    expect(decideStep(card, mergedOrSkipped, { 'steps.push.pushed': false })).toEqual({ run: true })
    expect(decideStep(card, mergedOrSkipped, { 'steps.push.pushed': true })).toMatchObject({
      run: false
    })
    expect(decideStep(card, mergedOrSkipped, {})).toMatchObject({ run: false })
  })

  it("merges a throwaway's commits back into the worktree while holding its home", () => {
    const mergeBack = definition.steps[5]
    expect(mergeBack).toMatchObject({
      name: 'merge_back',
      agent: 'shell',
      when: "{env.mode} == 'throwaway'",
      holdHome: true,
      exitCodes: { ok: [0], skip: [3] },
      timeoutMs: 5 * 60_000
    })
    expect(mergeBack.run).toContain('pilotcli git update-branch')
    expect(mergeBack.run).toContain(
      '--merge --to "$(git rev-parse HEAD)" --busy "$PILOT_HOME_BUSY"'
    )
  })

  it('still fixes when the flag hangs to its timeout, and flags a failed or timed-out fix', () => {
    const [, flag, , fix, , , , flagFailed] = definition.steps
    const timedOut = [
      { name: 'context', status: 'done' as const, always: false, error: null },
      { name: 'flag', status: 'timed_out' as const, always: flag.always, error: null },
      { name: 'catch_up', status: 'done' as const, always: false, error: null }
    ]
    expect(decideStep(fix, timedOut, {})).toEqual({ run: true })
    const fixTimedOut = [
      ...timedOut,
      { name: 'fix', status: 'timed_out' as const, always: false, error: null }
    ]
    expect(decideStep(flagFailed, fixTimedOut, { 'run.failed': true })).toEqual({ run: true })
    expect(decideStep(flagFailed, timedOut, { 'run.failed': false })).toMatchObject({ run: false })
  })

  it("sends my answers back to the asking session, else to fix-gitlab-ci's answers mode", () => {
    expect(definition.answers).toEqual({
      resume: 'asking_session',
      else: { agent: 'claude', skill: 'fix-gitlab-ci', mode: 'answers' }
    })
    expect(modeOutputs('fix-gitlab-ci', 'fix')).toEqual(['head', 'summary'])
    expect(modeOutputs('fix-gitlab-ci', 'answers')).toEqual(['outcome', 'item_status', 'reply'])
  })
})
