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

  it('flags the worktree around the fix, and only flags a failure when the fix failed', () => {
    expect(definition.steps.map((s) => [s.name, s.agent, s.always, s.when])).toEqual([
      ['flag', 'shell', true, null],
      ['fix', 'claude', false, null],
      ['merge_back', 'shell', false, "{env.mode} == 'throwaway'"],
      ['flag_failed', 'shell', true, '{run.failed} == true']
    ])
    expect(definition.steps[0].run).toContain(
      '--gitlab-mr "!$IID" --comment "fixing failed CI !$IID (auto)"'
    )
    expect(definition.steps[0].run).toContain('|| echo')
    expect(definition.steps[3].run).toContain('--unread')
    expect(definition.steps[1]).toMatchObject({
      skill: 'fix-gitlab-ci',
      mode: 'fix',
      promptStyle: 'wrapped'
    })
    for (const placeholder of ['{env.path}', '{env.mode}', '{worktree.path}']) {
      expect(definition.steps[1].prompt).toContain(placeholder)
    }
  })

  it("merges a throwaway's commits back into the worktree while holding its home", () => {
    const mergeBack = definition.steps[2]
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
    const [flag, fix, , flagFailed] = definition.steps
    const timedOut = [
      { name: 'flag', status: 'timed_out' as const, always: flag.always, error: null }
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
    expect(modeOutputs('fix-gitlab-ci', 'fix')).toEqual([])
    expect(modeOutputs('fix-gitlab-ci', 'answers')).toEqual(['outcome', 'item_status', 'reply'])
  })
})
