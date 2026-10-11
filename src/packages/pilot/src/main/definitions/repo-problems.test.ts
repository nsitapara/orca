import { describe, expect, it } from 'vitest'
import { EMPTY_PEOPLE } from '../../shared/people'
import { testDefinition } from '../../shared/definition/__fixtures__/definition'
import type { LoadedDefinitions } from './loader'
import { mergeRepoProblems, type RepoProblem } from './repo-problems'

const loaded = (ids: string[]): LoadedDefinitions => ({
  definitions: ids.map((id) => testDefinition({ id })),
  errors: [{ file: '/a/broken.yaml', errors: ['steps: needs at least one step'] }],
  people: EMPTY_PEOPLE,
  peopleError: null,
  missingDirs: []
})
const problem = (repo: string): RepoProblem => ({
  file: '/a/ci.yaml',
  repo,
  message: `repo "${repo}" isn't added to Pilot`
})

describe('mergeRepoProblems', () => {
  it('adds a problem beside the parse errors while its repo stays unlisted', () => {
    const out = mergeRepoProblems(loaded(['ci']), new Map([['ci', problem('nope')]]), () => false)
    expect(out.errors).toEqual([
      { file: '/a/broken.yaml', errors: ['steps: needs at least one step'] },
      { file: '/a/ci.yaml', errors: ['repo "nope" isn\'t added to Pilot'] }
    ])
  })

  it.each([
    ['the repo has been added since', ['ci'], () => true],
    ['the automation is gone or renamed', ['other'], () => false]
  ])('drops a problem when %s', (_name, ids, isListed) => {
    const out = mergeRepoProblems(loaded(ids), new Map([['ci', problem('nope')]]), isListed)
    expect(out.errors).toHaveLength(1)
  })

  it('leaves everything else as loaded', () => {
    const base = loaded(['ci'])
    expect(mergeRepoProblems(base, new Map(), () => false)).toEqual(base)
  })
})
