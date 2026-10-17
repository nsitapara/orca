import { describe, expect, it } from 'vitest'
import {
  envCreateArgs,
  envDeleteArgs,
  envRunKey,
  renderEnvSubject,
  resolveEnv,
  resolveEnvStack,
  type ResolvedEnvWorkspace
} from './env-args'

const wt = (at: string | null = null): ResolvedEnvWorkspace => ({
  kind: 'env',
  subject: { kind: 'worktree', worktree: '/wt/a', at },
  writes: true,
  stack: 'when_backend'
})
const head = ['env', 'create', '--run', 'r-1']

describe('envCreateArgs', () => {
  it.each([
    [
      'worktree, writes, when_backend',
      wt(),
      null,
      false,
      [
        ...head,
        '--worktree',
        '/wt/a',
        '--writes',
        'true',
        '--stack',
        'when-backend',
        '--format',
        'json'
      ]
    ],
    [
      'held: --throwaway with the reason',
      wt(),
      '05 is already working in it (Pilot run x)',
      false,
      [
        ...head,
        '--worktree',
        '/wt/a',
        '--writes',
        'true',
        '--stack',
        'when-backend',
        '--throwaway',
        '05 is already working in it (Pilot run x)',
        '--format',
        'json'
      ]
    ],
    [
      'worktree at a commit: never --throwaway',
      wt('abc'),
      'held',
      false,
      [
        ...head,
        '--worktree',
        '/wt/a',
        '--at',
        'abc',
        '--writes',
        'true',
        '--stack',
        'when-backend',
        '--format',
        'json'
      ]
    ],
    [
      'a branch at a commit',
      {
        kind: 'env',
        subject: { kind: 'branch', branch: 'web-1-x', at: 'abc' },
        writes: false,
        stack: 'never'
      } as ResolvedEnvWorkspace,
      null,
      false,
      [...head, '--branch', 'web-1-x', '--at', 'abc', '--stack', 'never', '--format', 'json']
    ],
    [
      'a kept new branch',
      {
        kind: 'env',
        subject: { kind: 'new_branch', newBranch: 'web-2-y', from: 'origin/dev', keep: true },
        writes: false,
        stack: 'full'
      } as ResolvedEnvWorkspace,
      null,
      false,
      [
        ...head,
        '--new-branch',
        'web-2-y',
        '--from',
        'origin/dev',
        '--keep',
        'true',
        '--stack',
        'full',
        '--format',
        'json'
      ]
    ],
    [
      'a dry run',
      wt(),
      null,
      true,
      [
        ...head,
        '--worktree',
        '/wt/a',
        '--writes',
        'true',
        '--stack',
        'when-backend',
        '--dry-run',
        'true',
        '--format',
        'json'
      ]
    ]
  ])('%s', (_name, env, throwaway, dryRun, expected) => {
    expect(envCreateArgs({ runId: 'r-1', env, throwaway, dryRun })).toEqual(expected)
  })

  it('deletes, keeping a kept folder', () => {
    expect(envDeleteArgs('r-1', false)).toEqual(['env', 'delete', 'r-1', '--format', 'json'])
    expect(envDeleteArgs('r-1', true)).toEqual([
      'env',
      'delete',
      'r-1',
      '--keep-folder',
      'true',
      '--format',
      'json'
    ])
  })
})

describe('renderEnvSubject', () => {
  it('fills every template from the fields', () => {
    const subject = { kind: 'branch', branch: '{mr.branch}', at: '{mr.head_sha}' } as const
    expect(renderEnvSubject(subject, { 'mr.branch': 'web-1', 'mr.head_sha': 'abc' }, '!1')).toEqual(
      { kind: 'branch', branch: 'web-1', at: 'abc' }
    )
  })
  it('names what is missing', () => {
    const subject = { kind: 'worktree', worktree: '{worktree.path}', at: null } as const
    expect(() => renderEnvSubject(subject, {}, '!1 web-1')).toThrow(
      "Can't prepare the workspace for !1 web-1: {worktree.path} has no value"
    )
  })
})

describe('resolveEnvStack, at run start', () => {
  const FIELD = { field: 'mr.stack' }
  it.each([
    ['a literal', 'backend', {}, 'backend'],
    ['a field holding a stack', FIELD, { 'mr.stack': 'full' }, 'full'],
    ['a field holding the flag spelling', FIELD, { 'mr.stack': 'when-backend' }, 'when_backend'],
    [
      'a field holding the YAML spelling, with a newline',
      FIELD,
      { 'mr.stack': 'when_backend\n' },
      'when_backend'
    ]
  ] as const)('%s', (_name, spec, fields, stack) => {
    expect(resolveEnvStack(spec, fields)).toBe(stack)
  })

  it.each([
    ['an empty value', { 'mr.stack': '' }, ''],
    ['no value (its script failed)', { 'mr.stack': null }, ''],
    ['no such field', {}, ''],
    ['a bad value', { 'mr.stack': 'huge' }, 'huge']
  ])('fails on %s', (_name, fields, value) => {
    expect(() => resolveEnvStack(FIELD, fields)).toThrow(
      `stack resolved to '${value}', expected never|backend|full|when_backend`
    )
  })

  it('resolveEnv fills the subject, then the stack', () => {
    const env = {
      kind: 'env',
      subject: { kind: 'worktree', worktree: '{worktree.path}', at: null },
      writes: true,
      stack: FIELD
    } as const
    expect(resolveEnv(env, { 'worktree.path': '/wt/a', 'mr.stack': 'backend' }, '!1')).toEqual({
      kind: 'env',
      subject: { kind: 'worktree', worktree: '/wt/a', at: null },
      writes: true,
      stack: 'backend'
    })
  })
})

describe('the run key a pid file is named by', () => {
  it.each([
    ['fix-failed-ci-202610131510-t42-1', 'fix-failed-ci-202610131510-t42-1'],
    ['Review_Requests-202610131510-answer-7', 'review-requests-202610131510-answer-7']
  ])('%s', (id, key) => {
    expect(envRunKey(id)).toBe(key)
  })
})
