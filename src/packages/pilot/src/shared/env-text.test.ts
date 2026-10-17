import { describe, expect, it } from 'vitest'
import type { RunEnv } from './api-types-env'
import {
  envCleanupLine,
  envStackLine,
  envWhereLine,
  runStatusWord,
  workspacePreviewLines
} from './env-text'

const env = (over: Partial<RunEnv>): RunEnv => ({
  state: 'ready',
  mode: 'in_place',
  reason: null,
  path: '/wt/a',
  sha: null,
  envFile: null,
  vars: {},
  stack: null,
  removedAt: null,
  deleteError: null,
  deleteAttempts: 0,
  ...over
})

describe('env words', () => {
  it.each([
    ['preparing', env({ state: 'preparing', mode: null }), 'Preparing its workspace'],
    [
      'deferred',
      env({ state: 'deferred', mode: null, reason: 'the stack cap is reached' }),
      'Deferred: the stack cap is reached'
    ],
    ['in place', env({}), 'Worked in place'],
    [
      'a throwaway',
      env({ mode: 'throwaway', reason: 'uncommitted changes' }),
      'Worked in a throwaway: uncommitted changes'
    ],
    ['kept', env({ mode: 'kept', path: '/wt/web-1' }), 'Worked in a new worktree, kept: /wt/web-1'],
    [
      'never made',
      env({ state: 'failed', mode: null, reason: 'git failed' }),
      "Its workspace wasn't made: git failed"
    ]
  ])('where: %s', (_name, e, line) => {
    expect(envWhereLine(e)).toBe(line)
  })

  it('the stack and its URLs', () => {
    expect(
      envStackLine(
        env({
          stack: {
            kind: 'backend',
            project: 'agents-r1',
            urls: { api: 'http://localhost:8123' },
            log: null
          }
        })
      )
    ).toBe('backend stack agents-r1 · api http://localhost:8123')
    expect(envStackLine(env({}))).toBeNull()
  })

  it.each([
    ['removed', env({ removedAt: 5 }), true, null],
    ['still running', env({}), false, null],
    ['ended, not removed yet', env({}), true, 'Being removed'],
    [
      'a delete that keeps failing',
      env({ deleteError: 'docker said no', deleteAttempts: 3 }),
      true,
      "Couldn't remove it yet (3 tries): docker said no"
    ],
    [
      'one failed try',
      env({ deleteError: 'busy', deleteAttempts: 1 }),
      true,
      "Couldn't remove it yet (1 try): busy"
    ],
    [
      'waiting on its create',
      env({ deleteError: 'create for r1 is still running', deleteAttempts: 0 }),
      true,
      'Waiting to remove it: create for r1 is still running'
    ],
    [
      'refused by pilotcli',
      env({ state: 'stuck', deleteError: 'invalid run name "r1/.."' }),
      true,
      'pilotcli refused to remove it (invalid run name "r1/.."); remove it by hand'
    ]
  ])('cleanup: %s', (_name, e, ended, line) => {
    expect(envCleanupLine(e, ended)).toBe(line)
  })

  it.each([
    [
      'running, preparing',
      { status: 'running', env: env({ state: 'preparing' }), outcome: null },
      'Preparing workspace'
    ],
    [
      'cancelled, deferred',
      { status: 'cancelled', env: env({ state: 'deferred' }), outcome: null },
      'Deferred'
    ],
    [
      'deferred and since removed',
      { status: 'cancelled', env: env({ state: 'deferred', removedAt: 9 }), outcome: null },
      'Deferred'
    ],
    [
      'done with nothing to do',
      { status: 'done', env: null, outcome: 'Nothing to do: the card was already answered' },
      'Nothing to do'
    ],
    ['anything else', { status: 'done', env: null, outcome: 'Done' }, 'done']
  ] as const)('status word: %s', (_name, run, word) => {
    expect(runStatusWord(run, (s) => s)).toBe(word)
  })

  it('dry run lines, one per previewed item', () => {
    const result = {
      tickId: 1,
      status: 'ok' as const,
      error: null,
      decisions: [
        {
          key: 'a',
          label: '!1',
          verdict: 'started' as const,
          reason: '',
          checks: [],
          onceKey: 'a',
          fields: {},
          workspace: 'would run in place'
        },
        {
          key: 'b',
          label: '!2',
          verdict: 'skipped' as const,
          reason: '',
          checks: [],
          onceKey: 'b',
          fields: {}
        }
      ]
    }
    expect(workspacePreviewLines(result)).toEqual(['!1: would run in place'])
    expect(workspacePreviewLines({ status: 'busy' })).toEqual([])
  })
})
