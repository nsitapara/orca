import { describe, expect, it } from 'vitest'
import { runOnceItem } from './run-once'

describe('runOnceItem', () => {
  it('is the repo, with its repo fields and no worktree of its own', () => {
    expect(
      runOnceItem({
        name: 'web-platform',
        id: 'r1',
        path: '/code/web-platform',
        base: 'origin/dev'
      })
    ).toEqual({
      kind: 'repo',
      key: 'repo:web-platform',
      label: 'web-platform',
      fields: {
        'repo.name': 'web-platform',
        'repo.path': '/code/web-platform',
        'repo.base': 'origin/dev'
      },
      worktreeHint: null,
      sortKeys: { waitingSince: null, priority: null }
    })
  })
})
