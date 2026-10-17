import { describe, expect, it } from 'vitest'
import {
  buildActivityProjectChoices,
  buildProjectIdByRepoId,
  expandProjectRepoIds
} from './activity-project-scope'
import { PROJECT_REPOS, REMOTE, projectRepo } from './activity-machines-test-fixtures'

const INDEX = buildProjectIdByRepoId(PROJECT_REPOS, [])

describe('expandProjectRepoIds', () => {
  it.each([
    { name: 'no filter', ids: [], expected: [] },
    {
      name: 'one copy picks every machine’s copy',
      ids: ['a-local'],
      expected: ['a-local', 'a-mini']
    },
    {
      name: 'the other machine’s copy picks it too',
      ids: ['a-mini'],
      expected: ['a-mini', 'a-local']
    },
    {
      name: 'repos without a remote stay per machine',
      ids: ['scratch-local'],
      expected: ['scratch-local']
    },
    { name: 'a stale id is left for the scope to drop', ids: ['gone'], expected: ['gone'] }
  ])('$name', ({ ids, expected }) => {
    expect(expandProjectRepoIds(ids, PROJECT_REPOS, INDEX)).toEqual(expected)
  })

  it('returns the filter itself when nothing is added', () => {
    const ids = ['scratch-local']
    expect(expandProjectRepoIds(ids, PROJECT_REPOS, INDEX)).toBe(ids)
  })
})

describe('buildProjectIdByRepoId', () => {
  it('takes a host setup’s project over the repo’s own remote', () => {
    const index = buildProjectIdByRepoId(PROJECT_REPOS, [
      { repoId: 'scratch-mini', projectId: 'git:example.com/acme/sample' }
    ])
    expect(index.get('scratch-mini')).toBe(index.get('a-local'))
  })
})

describe('buildActivityProjectChoices', () => {
  it.each([
    {
      name: 'one choice per project',
      ids: [],
      choices: ['a-local', 'scratch-local', 'scratch-mini'],
      selected: []
    },
    {
      name: 'a project picked on two machines is one selection',
      ids: ['a-local', 'a-mini'],
      choices: null,
      selected: ['a-local']
    },
    {
      name: 'the other machine’s copy selects the project',
      ids: ['a-mini'],
      choices: null,
      selected: ['a-local']
    }
  ])('$name', ({ ids, choices, selected }) => {
    const result = buildActivityProjectChoices(PROJECT_REPOS, ids, INDEX)
    if (choices) {
      expect(result.choices.map((r) => r.id)).toEqual(choices)
    }
    expect(result.selected.map((r) => r.id)).toEqual(selected)
  })

  it('stands a project for its copy that isn’t over SSH', () => {
    const repos = [
      projectRepo('a-ssh', 'ssh:box', { connectionId: 'box', gitRemoteIdentity: REMOTE }),
      PROJECT_REPOS[0]
    ]
    const result = buildActivityProjectChoices(repos, [], buildProjectIdByRepoId(repos, []))
    expect(result.choices.map((r) => r.id)).toEqual(['a-local'])
  })
})
