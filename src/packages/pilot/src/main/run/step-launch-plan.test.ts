import { describe, expect, it } from 'vitest'
import { testDefinition, testStep } from '../../shared/definition/__fixtures__/definition'
import type { AgentKind, StepDef } from '../../shared/definition/types'
import {
  agentArgv,
  buildStepPrompt,
  pilotStepEnv,
  planSession,
  stepTitle,
  terminalLaunchOptions,
  type SessionPlan
} from './step-launch-plan'

const prior = [
  {
    name: 'review',
    agent: 'claude',
    sessionId: '00000000-0000-4000-8000-000000000043'
  },
  { name: 'lint', agent: 'codex', sessionId: null }
]
const newId = () => '00000000-0000-4000-8000-000000000041'

describe('planSession', () => {
  it.each<[string, StepDef['session'], AgentKind, string | null, SessionPlan]>([
    [
      'new Claude session: pinned',
      { kind: 'new' },
      'claude',
      null,
      { kind: 'fresh', sessionId: '00000000-0000-4000-8000-000000000041' }
    ],
    [
      'new Codex session: learned later',
      { kind: 'new' },
      'codex',
      null,
      { kind: 'fresh', sessionId: null }
    ],
    [
      'continue an earlier step',
      { kind: 'continue', step: 'review' },
      'claude',
      null,
      { kind: 'resume', sessionId: '00000000-0000-4000-8000-000000000043' }
    ],
    [
      "continue a step that hasn't run",
      { kind: 'continue', step: 'fix' },
      'claude',
      null,
      {
        kind: 'missing',
        reason: 'Step "fix" hasn\'t run, so step "next" has no session to continue'
      }
    ],
    [
      'continue a step of another agent',
      { kind: 'continue', step: 'review' },
      'codex',
      null,
      {
        kind: 'missing',
        reason: 'Step "review" ran claude; step "next" runs codex'
      }
    ],
    [
      'continue a step without a session id',
      { kind: 'continue', step: 'lint' },
      'codex',
      null,
      { kind: 'missing', reason: 'Step "lint" has no session id to continue' }
    ],
    [
      "per worktree, the worktree's stored session",
      { kind: 'per_worktree' },
      'codex',
      '00000000-0000-4000-8000-000000000044',
      { kind: 'resume', sessionId: '00000000-0000-4000-8000-000000000044' }
    ],
    [
      'per worktree, first time: a fresh pinned one',
      { kind: 'per_worktree' },
      'claude',
      null,
      { kind: 'fresh', sessionId: '00000000-0000-4000-8000-000000000041' }
    ]
  ])('%s', (_name, session, agent, worktreeSession, plan) => {
    const step = testStep({ name: 'next', agent, session })
    expect(planSession({ step, agent, priorSteps: prior, worktreeSession, newId })).toEqual(plan)
  })
})

describe('agentArgv', () => {
  it.each<[AgentKind, SessionPlan, string[], string[]]>([
    [
      'claude',
      { kind: 'fresh', sessionId: '00000000-0000-4000-8000-000000000042' },
      ['--dangerously-skip-permissions'],
      [
        '--prompt-suggestions=false',
        '--session-id',
        '00000000-0000-4000-8000-000000000042',
        '--dangerously-skip-permissions'
      ]
    ],
    [
      'claude',
      { kind: 'resume', sessionId: '00000000-0000-4000-8000-000000000045' },
      [],
      ['--prompt-suggestions=false', '--resume', '00000000-0000-4000-8000-000000000045']
    ],
    [
      'codex',
      { kind: 'fresh', sessionId: null },
      ['--dangerously-bypass-approvals-and-sandbox'],
      ['--dangerously-bypass-approvals-and-sandbox']
    ],
    [
      'codex',
      { kind: 'resume', sessionId: '00000000-0000-4000-8000-000000000046' },
      ['-c', 'check_for_update_on_startup=false'],
      ['resume', '00000000-0000-4000-8000-000000000046', '-c', 'check_for_update_on_startup=false']
    ],
    [
      'claude',
      { kind: 'fork', sessionId: '00000000-0000-4000-8000-000000000047' },
      ['--dangerously-skip-permissions'],
      [
        '--prompt-suggestions=false',
        '--resume',
        '00000000-0000-4000-8000-000000000047',
        '--fork-session',
        '--dangerously-skip-permissions'
      ]
    ],
    [
      'codex',
      { kind: 'fork', sessionId: '00000000-0000-4000-8000-000000000048' },
      [],
      ['fork', '00000000-0000-4000-8000-000000000048']
    ],
    [
      'claude',
      { kind: 'missing', reason: 'x' },
      ['--model', 'opus'],
      ['--prompt-suggestions=false', '--model', 'opus']
    ]
  ])('%s %j', (agent, session, args, argv) => {
    expect(agentArgv(agent, session, args)).toEqual(argv)
  })
})

describe('pilotStepEnv', () => {
  it('names the run, step, automation, item and powers', () => {
    expect(
      pilotStepEnv({
        runId: 'r-1',
        automationId: 'fix-ci',
        itemKey: 'mr:1561',
        stepName: 'fix',
        stepIdx: 1,
        powers: ['commit', 'push']
      })
    ).toEqual({
      PILOT_RUN_ID: 'r-1',
      PILOT_STEP: 'fix',
      PILOT_STEP_IDX: '1',
      PILOT_AUTOMATION_ID: 'fix-ci',
      PILOT_ITEM_KEY: 'mr:1561',
      PILOT_POWERS: 'commit,push'
    })
  })
})

const STEP_ENV = {
  runId: 'r-1',
  automationId: 'fix-ci',
  itemKey: 'mr:1561',
  stepName: 'fix',
  stepIdx: 0,
  powers: ['commit']
}

describe('terminalLaunchOptions', () => {
  it("puts the env's variables under Pilot's step env", () => {
    const opts = terminalLaunchOptions({
      agent: 'claude',
      prompt: 'p',
      title: 't',
      env: STEP_ENV,
      args: [],
      session: { kind: 'fresh', sessionId: null },
      runEnv: { API_URL: 'http://a', PILOT_RUN_ID: 'forged' }
    })
    expect(opts.pilot.env).toMatchObject({
      API_URL: 'http://a',
      PILOT_RUN_ID: STEP_ENV.runId
    })
  })

  it("combines the step env, the session's argv then the step args, the title and the prompt", () => {
    expect(
      terminalLaunchOptions({
        agent: 'claude',
        prompt: 'Go.',
        title: 'Fix CI · !1561',
        env: {
          runId: 'r-1',
          automationId: 'fix-ci',
          itemKey: 'mr:1561',
          stepName: 'fix',
          stepIdx: 0,
          powers: ['commit']
        },
        args: ['--dangerously-skip-permissions'],
        session: {
          kind: 'fresh',
          sessionId: '00000000-0000-4000-8000-000000000042'
        }
      })
    ).toEqual({
      agent: 'claude',
      prompt: 'Go.',
      title: '[Automation] Fix CI · !1561',
      pilot: {
        env: {
          PILOT_RUN_ID: 'r-1',
          PILOT_STEP: 'fix',
          PILOT_STEP_IDX: '0',
          PILOT_AUTOMATION_ID: 'fix-ci',
          PILOT_ITEM_KEY: 'mr:1561',
          PILOT_POWERS: 'commit'
        },
        argv: [
          '--prompt-suggestions=false',
          '--session-id',
          '00000000-0000-4000-8000-000000000042',
          '--dangerously-skip-permissions'
        ]
      }
    })
  })
})

describe('buildStepPrompt', () => {
  const definition = testDefinition({ name: 'Fix failed CI on my MRs' })
  const fields = { 'mr.iid': 1561, 'mr.pipeline': 99 }
  const prompt = (step: StepDef, modeText: string | null = null) =>
    buildStepPrompt({
      definition,
      step,
      runId: 'r-1',
      label: '!1561 web-1493',
      fields,
      modeText
    })
  const preamble =
    'Started by the Pilot automation "Fix failed CI on my MRs" (run r-1) for !1561 web-1493.'

  it.each<[string, StepDef, string | null, string]>([
    [
      'wrapped, as M1',
      testStep({
        skill: 'fix-gitlab-ci',
        prompt: 'Fix pipeline {mr.pipeline} on !{mr.iid}.'
      }),
      null,
      [preamble, 'Use the fix-gitlab-ci skill.', '', 'Fix pipeline 99 on !1561.'].join('\n')
    ],
    [
      "wrapped with the mode's text before the prompt",
      testStep({
        skill: 'fix-gitlab-ci',
        mode: 'answers',
        prompt: 'Apply the answer.'
      }),
      '  Read the card first.\n',
      [
        preamble,
        'Use the fix-gitlab-ci skill.',
        '',
        'Read the card first.',
        '',
        'Apply the answer.'
      ].join('\n')
    ],
    [
      'wrapped, a skill alone',
      testStep({ skill: 'mr-next-step', prompt: null }),
      null,
      [preamble, 'Use the mr-next-step skill.'].join('\n')
    ],
    [
      'raw: the rendered prompt only',
      testStep({
        prompt: '/remove-manual-memo {mr.iid}\n',
        promptStyle: 'raw',
        skill: 'x'
      }),
      'ignored',
      '/remove-manual-memo 1561'
    ],
    [
      'a missing field stays a literal placeholder',
      testStep({ prompt: 'Run {mr.branch}' }),
      null,
      [preamble, '', 'Run {mr.branch}'].join('\n')
    ]
  ])('%s', (_name, step, modeText, expected) => {
    expect(prompt(step, modeText)).toBe(expected)
  })
})

describe('stepTitle', () => {
  it('adds the step name only when the automation has several steps', () => {
    const one = testDefinition({
      name: 'Fix CI',
      steps: [testStep({ name: 'fix' })]
    })
    const two = testDefinition({
      name: 'Review',
      steps: [testStep({ name: 'review' }), testStep({ name: 'fix' })]
    })
    expect(stepTitle(one, one.steps[0], '!1561')).toBe('Fix CI · !1561')
    expect(stepTitle(two, two.steps[1], '!1561')).toBe('Review · !1561 · fix')
  })
})
