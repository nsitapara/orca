import { readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { decideStep } from '../../src/shared/run/step-plan'
import { loadPortedAutomation } from './ported'

const JOB = 'mr-feedback'
const SKILL = 'global-command-address-mr-feedback'
const { definition } = loadPortedAutomation(JOB)

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
    expect(modeText('feedback')).toContain('pilot inbox add')
    expect(modeText('answers')).toContain('item_status=stale')
  })
})
