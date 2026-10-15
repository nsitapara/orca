import { describe, expect, it } from 'vitest'
import { testDefinition, testStep } from '../definition/__fixtures__/definition'
import type { AutomationDefinition } from '../definition/types'
import { chainOf, checkNamesOf } from './chain'

const rows = (def: AutomationDefinition, all: AutomationDefinition[] = [def]): string[] =>
  chainOf(def, all).map((p) => `${p.sub ? '↳' : ''}${p.name}:${p.who}`)

const shell = (name: string, run: string) => testStep({ name, agent: 'shell', run, prompt: null })

describe('chainOf', () => {
  it.each<[string, AutomationDefinition, string[]]>([
    [
      'a run-once shell job',
      testDefinition({
        items: null,
        workspace: { kind: 'main_checkout' },
        steps: [shell('pull', './pull.sh')]
      }),
      ['Starts:pilot', 'Picks:pilot', 'Workspace:pilot', 'pull:script']
    ],
    [
      'field scripts, an ask and answers',
      testDefinition({
        items: {
          kind: 'merge_request',
          where: {},
          match: [],
          customFields: [
            { name: 'head8', script: 'sweep.py field head8', cache: 'per_head', timeoutMs: 1 },
            {
              name: 'card_context',
              script: 'sweep.py field context',
              cache: 'per_tick',
              timeoutMs: 1
            }
          ]
        },
        start: 'ask_first',
        askFirst: { title: 'Prepare a review of !{mr.iid}?', context: '', options: [] },
        answers: {
          resume: 'asking_session',
          else: { agent: 'claude', skill: 'review-mr', mode: 'answers' }
        }
      }),
      [
        'Starts:pilot',
        'Picks:pilot',
        '↳head8:script',
        '↳card_context:script',
        'Asks you:you',
        'Workspace:pilot',
        'step1:agent',
        'Answers:you'
      ]
    ],
    [
      'an ids script, gates and a check script',
      testDefinition({
        items: {
          kind: 'linear_ticket',
          where: { ids_from: { run: 'mode.py list' }, team: 'WEB' },
          match: [],
          customFields: []
        },
        checks: [
          { kind: 'quota', agent: 'claude', weekly: 90, session: 95 },
          { kind: 'script', run: 'mode.py check', timeoutMs: 60_000 }
        ]
      }),
      [
        'Starts:pilot',
        'Picks:pilot',
        '↳ids:script',
        'Gates:pilot',
        '↳Check mode.py:script',
        'Workspace:pilot',
        'step1:agent'
      ]
    ]
  ])('lists %s in the order a run meets them', (_name, def, expected) => {
    expect(rows(def)).toEqual(expected)
  })

  it('says what each part runs, from the YAML', () => {
    const def = testDefinition({
      schedule: '10 * * * *',
      items: {
        kind: 'merge_request',
        where: { author: { people: ['nish'] }, reviewer: { not: { people: ['nish'] } } },
        match: [],
        customFields: []
      },
      oncePer: '{mr.iid}:{mr.pipeline}',
      limits: { perTick: 3, atOnce: null, timeoutMs: null, order: 'listed' },
      checks: [
        { kind: 'worktree_exists' },
        { kind: 'quota', agent: 'claude', weekly: 90, session: 95 }
      ],
      workspace: {
        kind: 'env',
        subject: { kind: 'worktree', worktree: '{worktree.path}', at: null },
        writes: true,
        stack: 'when_backend'
      },
      steps: [
        testStep({
          name: 'flag',
          agent: 'shell',
          run: 'orca worktree set',
          prompt: null,
          always: true
        }),
        testStep({ name: 'fix', skill: 'fix-gitlab-ci', mode: 'fix' }),
        testStep({
          name: 'merge_back',
          agent: 'shell',
          run: 'pilotcli git update-branch',
          prompt: null,
          when: "{env.mode} == 'throwaway'"
        }),
        testStep({
          name: 'start',
          skill: 'dev-e2e-fix',
          promptStyle: 'raw',
          prompt: '/dev-e2e-fix {ticket.id}'
        })
      ]
    })
    const by = Object.fromEntries(chainOf(def, [def]).map((p) => [p.key, p]))
    expect(by.starts.runs).toBe('On 10 * * * * (America/Los_Angeles)')
    expect(by.picks).toMatchObject({
      runs: 'Merge requests · author nish · reviewer not nish · once per {mr.iid}:{mr.pipeline} · up to 3 a tick',
      short: 'MRs'
    })
    expect(by.gates).toMatchObject({
      runs: 'Worktree · Quota under 90% week, 95% session',
      checks: ['Worktree', 'Quota']
    })
    expect(by.workspace).toMatchObject({
      runs: 'An env of {worktree.path} · writes · stack when_backend',
      gives: ['env.*']
    })
    expect(by['step:0']).toMatchObject({
      who: 'script',
      runs: 'orca worktree set',
      always: true,
      short: 'flag'
    })
    expect(by['step:1']).toMatchObject({
      who: 'agent',
      agent: 'claude',
      runs: 'Claude · fix-gitlab-ci (fix)',
      short: 'Claude · fix-gitlab-ci',
      stepIdx: 1
    })
    expect(by['step:2'].when).toBe("{env.mode} == 'throwaway'")
    expect(by['step:3'].runs).toBe('Claude · /dev-e2e-fix {ticket.id}')
  })

  it("shows a fed stage's start and the handover that feeds it", () => {
    const one = testDefinition({
      id: 'one',
      job: {
        id: '13',
        name: 'Fix',
        stage: 1,
        label: 'Ticket',
        feeds: [
          {
            to: 'two',
            pass: { id: 'ticket' },
            run: 'now',
            when: 'success',
            caption: 'the tickets it opens',
            trust: 'shell'
          }
        ]
      }
    })
    const two = testDefinition({
      id: 'two',
      schedule: '6,36 * * * *',
      job: { id: '13', name: null, stage: 2, label: 'Fix', feeds: [] }
    })
    expect(chainOf(one, [one, two]).find((p) => p.kind === 'handover')).toMatchObject({
      key: 'handover:two',
      to: 'two',
      runs: 'Hands stage 2 the tickets it opens · runs it at once',
      when: 'this run succeeds'
    })
    expect(chainOf(two, [one, two])[0].runs).toBe(
      'When stage 1 hands it the tickets it opens; otherwise on 6,36 * * * * (America/Los_Angeles)'
    )
  })

  it('names the check columns in the order the YAML lists them', () => {
    const def = testDefinition({
      checks: [
        { kind: 'quota', agent: 'claude', weekly: 90, session: 95 },
        { kind: 'script', run: 'x/check.py', timeoutMs: 1 }
      ]
    })
    expect(checkNamesOf(chainOf(def, [def]))).toEqual(['Quota', 'Check check.py'])
  })
})
