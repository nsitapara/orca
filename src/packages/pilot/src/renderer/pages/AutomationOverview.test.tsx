// @vitest-environment happy-dom
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import type { StepDef } from '../../shared/definition/types'
import { AutomationOverview, stepSummary } from './AutomationOverview'
import { detail } from './fixtures'

const step = (over: Partial<StepDef>): StepDef => ({
  name: 'fix',
  agent: 'claude',
  skill: 'fix-gitlab-ci',
  mode: null,
  prompt: null,
  promptStyle: 'wrapped',
  args: [],
  session: { kind: 'new' },
  env: {},
  run: null,
  exitCodes: { ok: [0], skip: [], stop: [] },
  when: null,
  always: false,
  timeoutMs: null,
  outputs: [],
  ...over
})

describe('stepSummary', () => {
  it.each([
    ['an agent step with a skill', step({}), 'Claude · fix-gitlab-ci'],
    ['with a mode', step({ mode: 'answers' }), 'Claude · fix-gitlab-ci (mode answers)'],
    [
      'a conditional Codex step that continues a session',
      step({
        agent: 'codex',
        skill: null,
        when: '{steps.review.changed} == true',
        session: { kind: 'continue', step: 'review' }
      }),
      "Codex · when {steps.review.changed} == true · continues review's session"
    ],
    [
      'a cleanup shell step',
      step({
        agent: 'shell',
        skill: null,
        run: './teardown.sh {worktree.path}',
        always: true,
        timeoutMs: 600_000
      }),
      'Shell · runs ./teardown.sh {worktree.path} · always runs · times out after 10m'
    ],
    [
      'one session per worktree, an hour limit',
      step({ session: { kind: 'per_worktree' }, timeoutMs: 3_600_000 }),
      'Claude · fix-gitlab-ci · times out after 60m · one session per worktree'
    ]
  ])('%s', (_name, s, text) => {
    expect(stepSummary(s)).toBe(text)
  })
})

describe('AutomationOverview', () => {
  afterEach(cleanup)

  it('lists the facts, the steps in order and the YAML, with powers as they are enforced', () => {
    render(
      <AutomationOverview
        detail={{ ...detail, summary: { ...detail.summary, powers: ['commit', 'push'] } }}
      />
    )
    expect(screen.getByText('commit, push')).toBeTruthy()
    expect(screen.queryByText(/not enforced/)).toBeNull()
    expect(screen.getByText('1. fix')).toBeTruthy()
    expect(screen.getByText('Claude · fix-gitlab-ci (mode fix)')).toBeTruthy()
    expect(screen.getByText(/schedule: manual/)).toBeTruthy()
  })

  it('says an automation with no powers acts only inside the worktree', () => {
    render(<AutomationOverview detail={detail} />)
    expect(screen.getByText('Nothing outside the worktree')).toBeTruthy()
  })
})
