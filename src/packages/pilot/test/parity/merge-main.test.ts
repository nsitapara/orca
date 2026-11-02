import { readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { decideStep } from '../../src/shared/run/step-plan'
import { loadPortedAutomation } from './ported'

// 02 runs once per MR since 2026-11-02: it was one update-my-mrs coordinator, whose dry run could only say the repo
// would start. Each MR now shows in a dry run with pilotcli's reason (staging hold, already current, unpushed).
const JOB = 'merge-main'
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

describe('02 · Merge main into my MR branches: the definition', () => {
  it('picks my open MRs, each decided by its worktree, ownership and pilotcli check-item merge-main', () => {
    expect(definition).toMatchObject({
      name: '02 · Merge main into my MR branches',
      schedule: '0 3 * * *',
      timezone: 'America/Los_Angeles',
      missedRunGraceMs: 12 * 3_600_000,
      oncePer: '{mr.iid}:{run.tick}',
      limits: { atOnce: 2 },
      powers: ['commit', 'push'],
      inbox: '{mr.author}'
    })
    expect(definition.items).toMatchObject({ kind: 'merge_request' })
    expect(definition.workspace).toEqual({
      kind: 'env',
      subject: { kind: 'worktree', worktree: '{worktree.path}', at: null },
      writes: true,
      stack: 'when_backend'
    })
    expect(definition.checks).toMatchObject([
      { kind: 'field', expr: '{mr.iid} != 1214 and {mr.iid} != 1238' },
      { kind: 'worktree_exists' },
      { kind: 'mr', rule: 'mine' },
      { kind: 'script', run: 'pilotcli automations check-item merge-main --pilot-item - --format text' }
    ])
  })

  it('runs the chain: hooks, context, flag, catch-up, the merge, push, merge back, card, and a flag on failure', () => {
    expect(definition.steps.map((s) => [s.name, s.agent, s.always, s.when])).toEqual([
      ['trust_hooks', 'shell', false, null],
      ['context', 'shell', false, null],
      ['flag', 'shell', true, "{steps.context.outcome} == 'ok'"],
      ['catch_up', 'shell', false, null],
      ['merge', 'codex', false, null],
      ['push', 'shell', false, '{steps.merge.head} != null and {steps.context.remote} != null'],
      ['merge_back', 'shell', false, "{env.mode} == 'throwaway'"],
      ['card', 'shell', false, "{steps.merge.head} != null and {steps.push.outcome} != 'ok'"],
      ['flag_failed', 'shell', true, '{run.failed} == true']
    ])
    const merge = definition.steps[4]
    expect(merge).toMatchObject({ skill: 'global-command-merge-main', mode: 'merge' })
    for (const placeholder of [
      '{env.path}',
      '{env.mode}',
      '{worktree.path}',
      '{steps.catch_up.status}',
      '{steps.context.result}'
    ]) {
      expect(merge.prompt).toContain(placeholder)
    }
  })

  it('gathers the context first: nothing to merge ends the run before the flag and the agent', () => {
    const [, context, flag, , merge] = definition.steps
    expect(context.run).toBe('pilotcli skills get-context merge-main "$IID"')
    expect(context.env).toEqual({ IID: '{mr.iid}' })
    expect(context.exitCodes).toEqual({ ok: [0], skip: [], stop: [3] })
    const stopped = [{ name: 'context', status: 'stopped' as const, always: false, error: null }]
    expect(decideStep(flag, stopped, { 'steps.context.outcome': 'skip' })).toMatchObject({
      run: false
    })
    expect(decideStep(merge, stopped, {})).toMatchObject({ run: false })
  })

  it("pushes the merge pinned, else leaves a push card (the staging hold is the check's and the context's)", () => {
    const [, , , , , push, , card] = definition.steps
    expect(push.run).toBe(
      'pilotcli git push-branch "$BRANCH" --checkout . --expect-sha "$REMOTE" --expect-head "$HEAD_SHA" --from "$FROM"'
    )
    expect(push.env).toEqual({
      BRANCH: '{mr.branch}',
      HEAD_SHA: '{steps.merge.head}',
      REMOTE: '{steps.context.remote}',
      FROM: '{env.sha}'
    })
    expect(push.exitCodes).toMatchObject({ ok: [0], skip: [1, 2, 3, 5] })
    const merged = { 'steps.context.remote': 'b'.repeat(40), 'steps.merge.head': 'a'.repeat(40) }
    expect(decideStep(push, [], merged)).toEqual({ run: true })
    expect(decideStep(push, [], { 'steps.context.remote': 'b'.repeat(40) })).toMatchObject({
      run: false
    })
    expect(decideStep(card, [], { ...merged, 'steps.push.outcome': 'skip' })).toEqual({ run: true })
    expect(decideStep(card, [], { ...merged, 'steps.push.outcome': 'ok' })).toMatchObject({
      run: false
    })
    // No merge commit (a question, a blocker): no card.
    expect(decideStep(card, [], { 'steps.push.outcome': 'skip' })).toMatchObject({ run: false })
  })

  it("sends my answers back to the asking session, else to the skill's answers mode", () => {
    expect(definition.answers).toEqual({
      resume: 'asking_session',
      else: { agent: 'codex', skill: 'global-command-merge-main', mode: 'answers' }
    })
    expect(modeOutputs('global-command-merge-main', 'merge')).toEqual(['head', 'summary'])
    expect(modeOutputs('global-command-merge-main', 'answers')).toEqual(['outcome', 'item_status', 'reply'])
  })
})
