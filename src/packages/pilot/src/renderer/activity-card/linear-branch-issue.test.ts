import { describe, expect, it } from 'vitest'
import { linearIdOfBranch } from './linear-branch-issue'

describe('linearIdOfBranch', () => {
  it.each([
    ['a Linear branch name', 'web-2153-create-a-review-skill-for-team-to-iterate-on', 'WEB-2153'],
    ['a full ref', 'refs/heads/web-2122-ticket-priority', 'WEB-2122'],
    ["Linear's username/ form", 'nish/web-2153-create', 'WEB-2153'],
    ['the bare id', 'WEB-2153', 'WEB-2153'],
    ['a branch with no id', 'feature', null],
    ['a typed prefix with no id', 'fix/inbox-card-place', null],
    ['a name that starts with a number', '2026-10-web', null]
  ])('%s', (_case, branch, id) => {
    expect(linearIdOfBranch(branch)).toBe(id)
  })
})
