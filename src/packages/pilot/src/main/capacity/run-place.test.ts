import { describe, expect, it } from 'vitest'
import type { StepRow } from '../../shared/api-types'
import type { RunEnv } from '../../shared/api-types-env'
import { testDefinition, testStep } from '../../shared/definition/__fixtures__/definition'
import { testStepRow } from '../../shared/run-views/__fixtures__/runs'
import { runHome, runPlace } from './run-place'

function env(over: Partial<RunEnv> = {}): RunEnv {
  return {
    state: 'removed',
    mode: 'throwaway',
    reason: 'uncommitted changes',
    path: '/agents/agents-r1',
    sha: 'a'.repeat(40),
    envFile: null,
    vars: {},
    stack: null,
    removedAt: 5,
    deleteError: null,
    deleteAttempts: 0,
    ...over
  }
}

function shell(name: string, command: string | null, outcome = 'ok', reason = ''): StepRow {
  const result = command === null ? null : { command, outcome, reason }
  return testStepRow({ name, kind: 'shell', agent: 'shell', status: 'done', result })
}

describe('runPlace', () => {
  it.each<[string, RunEnv | null, ReturnType<typeof runPlace>]>([
    [
      'a throwaway with its own stack',
      env({ stack: { kind: 'backend', project: 'agents-r1', urls: {}, log: null } }),
      { mode: 'throwaway', reason: 'uncommitted changes', stack: true }
    ],
    [
      'in place, no reason given',
      env({ mode: 'in_place', reason: '' }),
      { mode: 'in_place', reason: null, stack: false }
    ],
    ['still preparing', env({ state: 'preparing', mode: null }), null],
    ['no env', null, null]
  ])('%s', (_name, given, place) => {
    expect(runPlace({ env: given })).toEqual(place)
  })
})

describe('runHome', () => {
  const def = testDefinition({
    steps: [
      testStep({ name: 'review' }),
      testStep({ name: 'publish', agent: 'shell', run: 'x', prompt: null }),
      testStep({ name: 'merge_back', agent: 'shell', run: 'x', prompt: null, holdHome: true })
    ]
  })
  it.each<[string, StepRow[], RunEnv | null, ReturnType<typeof runHome>]>([
    [
      'pushed, merged back',
      [shell('publish', 'git push-branch'), shell('merge_back', 'git update-branch')],
      env(),
      { pushed: { ok: true, reason: null }, mergedBack: { ok: true, reason: null } }
    ],
    [
      'a push refused, the merge back skipped, the commits kept',
      [
        shell('publish', 'git push-branch', 'skip', 'origin moved'),
        shell('merge_back', 'git update-branch', 'skip', 'uncommitted changes')
      ],
      env({ kept: 'pilot/r1' }),
      {
        pushed: { ok: false, reason: 'origin moved' },
        mergedBack: { ok: false, reason: 'uncommitted changes' },
        kept: 'pilot/r1'
      }
    ],
    [
      'kept commits since merged home carry where that stands',
      [],
      env({
        kept: 'pilot/r1',
        keptHome: {
          state: 'merged',
          reason: null,
          attempts: 2,
          nextAt: null,
          since: 1,
          noticed: false
        }
      }),
      { kept: 'pilot/r1', keptHome: { state: 'merged', reason: null } }
    ],
    [
      'steps their `when` skipped say nothing',
      [shell('publish', null), shell('merge_back', null)],
      env(),
      null
    ],
    [
      "another step's update-branch is no merge back",
      [shell('catch_up', 'git update-branch')],
      env(),
      null
    ]
  ])('%s', (_name, steps, given, home) => {
    expect(runHome({ env: given, steps }, def)).toEqual(home)
  })
})
