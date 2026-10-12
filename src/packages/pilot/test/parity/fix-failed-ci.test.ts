import { readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
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
      enabled: false,
      missedRunGraceMs: 12 * 3_600_000,
      oncePer: '{mr.iid}:{mr.pipeline}',
      limits: { perTick: 3 },
      workspace: { kind: 'item_worktree' },
      powers: ['commit', 'push'],
      inbox: '{mr.author}'
    })
    expect(definition.items).toMatchObject({ kind: 'merge_request' })
    expect(definition.checks).toEqual([
      { kind: 'worktree_exists' },
      { kind: 'session_none_open', scope: 'automation' },
      { kind: 'worktree_clean' },
      { kind: 'quota', agent: 'claude', weekly: 90, session: 95 }
    ])
  })

  it('flags the worktree around the fix, and only flags a failure when the fix failed', () => {
    expect(definition.steps.map((s) => [s.name, s.agent, s.always, s.when])).toEqual([
      ['flag', 'shell', false, null],
      ['fix', 'claude', false, null],
      ['flag_failed', 'shell', true, "{steps.fix.status} == 'failed'"]
    ])
    expect(definition.steps[0].run).toContain(
      '--gitlab-mr "!$IID" --comment "fixing failed CI !$IID (auto)"'
    )
    expect(definition.steps[0].run).toContain('|| echo')
    expect(definition.steps[2].run).toContain('--unread')
    expect(definition.steps[1]).toMatchObject({
      skill: 'fix-gitlab-ci',
      mode: 'fix',
      promptStyle: 'wrapped'
    })
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
