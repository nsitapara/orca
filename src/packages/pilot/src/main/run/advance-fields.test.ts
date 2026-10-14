import { describe, expect, it } from 'vitest'
import type { RunRow } from '../../shared/api-types'
import type { RunEnv } from '../../shared/api-types-env'
import { parseAutomationYaml } from '../../shared/definition/parse'
import { stepInputFields } from './advance-fields'

const parsed = parseAutomationYaml(
  'name: n\nrepo: r\nschedule: manual\nsteps: [ { agent: shell, run: ./x.sh } ]\n',
  '/a/n.yaml'
)
if (!parsed.ok) {
  throw new Error('setup')
}
const env = (over: Partial<RunEnv>): RunEnv => ({
  state: 'ready',
  mode: 'in_place',
  reason: '',
  path: '/wt/a',
  sha: 'abc',
  envFile: null,
  vars: {},
  stack: null,
  removedAt: null,
  deleteError: null,
  deleteAttempts: 0,
  ...over
})
const base = {
  id: 'r1',
  automationId: 'n',
  startedAt: 0,
  tickId: null,
  worktreeId: 'id-env'
} as RunRow

describe('what a step of an env run reads', () => {
  it.each([
    [
      'not an env run',
      { worktreePath: '/wt/a', homePath: null, env: null },
      { 'worktree.path': '/wt/a', 'worktree.id': 'id-env' }
    ],
    [
      'in place',
      { worktreePath: '/wt/a', homePath: '/wt/a', env: env({}) },
      {
        'worktree.path': '/wt/a',
        'worktree.id': 'id-env',
        'env.mode': 'in_place',
        'env.path': '/wt/a'
      }
    ],
    [
      'a throwaway: worktree.* stays the item’s, the folder is env.path',
      {
        worktreePath: '/agents/a',
        homePath: '/wt/a',
        env: env({
          mode: 'throwaway',
          reason: 'uncommitted changes',
          path: '/agents/a',
          envFile: '/s/env.sh',
          stack: { kind: 'backend', project: 'agents-r1', urls: {}, log: null }
        })
      },
      {
        'worktree.path': '/wt/a',
        'worktree.id': 'wt-item',
        'env.mode': 'throwaway',
        'env.reason': 'uncommitted changes',
        'env.path': '/agents/a',
        'env.file': '/s/env.sh',
        'env.stack': 'backend'
      }
    ]
  ])('%s', (_name, run, expected) => {
    const fields = stepInputFields({
      run: { ...base, ...run },
      def: parsed.definition,
      item: { 'worktree.id': 'wt-item' },
      rows: [],
      idx: 0,
      answer: null
    })
    expect(fields).toMatchObject(expected)
  })
})
