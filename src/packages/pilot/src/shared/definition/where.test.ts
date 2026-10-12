import { describe, expect, it } from 'vitest'
import type { ItemKind } from './types'
import { WHERE_SCHEMAS, worktreeWhereSchema } from './where'

describe('WHERE_SCHEMAS', () => {
  const valid: [ItemKind, Record<string, unknown>][] = [
    ['merge_request', {}],
    [
      'merge_request',
      {
        state: 'open',
        author: { people: ['nish'] },
        reviewer: { not: { group: 'web' } },
        head_pipeline: 'failed',
        draft: false,
        approved_by: 'none',
        target_branch: 'dev'
      }
    ],
    ['merge_request', { approved_by: { group: 'web' }, author: 'anyone' }],
    [
      'worktree',
      { has_mr: true, mr_author: { people: ['nish'] }, mr_state: 'open', branch_owner: 'anyone' }
    ],
    ['pipeline', { ref: 'dev', status: 'failed', select: 'newest_suite_running' }],
    [
      'linear_ticket',
      { assignee: { people: ['nish'] }, state_type: ['unstarted'], team: 'WEB', has_branch: false }
    ]
  ]
  it.each(valid)('accepts a %s where block %j', (kind, where) => {
    expect(WHERE_SCHEMAS[kind].safeParse(where)).toMatchObject({ success: true, data: where })
  })

  const invalid: [ItemKind, Record<string, unknown>][] = [
    ['merge_request', { author: 'nish' }],
    ['merge_request', { author: { not: { people: ['nish'], bogus: 1 } } }],
    ['merge_request', { approved_by: 'nobody' }],
    ['merge_request', { has_mr: true }],
    ['worktree', { author: 'anyone' }],
    ['pipeline', {}],
    ['pipeline', { ref: 'dev', select: 'oldest' }],
    ['linear_ticket', { state_type: 'started' }]
  ]
  it.each(invalid)('rejects a %s where block %j', (kind, where) => {
    expect(WHERE_SCHEMAS[kind].safeParse(where).success).toBe(false)
  })
})

describe('worktreeWhereSchema commits clause', () => {
  it.each([
    ['an ignore_trailer', { commits: { ignore_trailer: 'Agent-Loop: standards' } }, true],
    ['first_sight: baseline', { commits: { first_sight: 'baseline' } }, true],
    ['first_sight: test_recent', { commits: { first_sight: 'test_recent' } }, true],
    ['an empty clause', { commits: {} }, true],
    ['a duration instead of a mode', { commits: { first_sight: '7d' } }, false],
    ['the old exclude key', { commits: { exclude: 'Agent-Loop:' } }, false]
  ])('%s', (_name, where, ok) => {
    expect(worktreeWhereSchema.safeParse(where).success).toBe(ok)
  })
})
