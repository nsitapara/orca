import { describe, expect, it } from 'vitest'
import { EMPTY_PEOPLE } from '../../shared/people'
import { testDefinition } from '../../shared/definition/__fixtures__/definition'
import { runsOnGate } from '../scheduler/runs-on-gate'
import type { LoadedDefinitions } from './loader'
import { mergeRepoProblems, type RepoProblem } from './repo-problems'

const loaded = (ids: string[]): LoadedDefinitions => ({
  definitions: ids.map((id) => testDefinition({ id, repo: 'nope', schedule: '10 * * * *' })),
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

  it.each<[string, ReturnType<typeof testDefinition>[], () => boolean]>([
    [
      'the repo has been added since',
      [testDefinition({ id: 'ci', repo: 'nope', schedule: '10 * * * *' })],
      () => true
    ],
    [
      'the automation is gone or renamed',
      [testDefinition({ id: 'other', repo: 'nope', schedule: '10 * * * *' })],
      () => false
    ],
    [
      "the automation's repo: was fixed",
      [testDefinition({ id: 'ci', repo: 'web-platform', schedule: '10 * * * *' })],
      () => false
    ],
    [
      'the automation was disabled since',
      [testDefinition({ id: 'ci', repo: 'nope', schedule: '10 * * * *', enabled: false })],
      () => false
    ],
    [
      'the automation became manual',
      [testDefinition({ id: 'ci', repo: 'nope', schedule: 'manual' })],
      () => false
    ]
  ])('drops a problem when %s', (_name, definitions, isListed) => {
    const out = mergeRepoProblems(
      { ...loaded([]), definitions },
      new Map([['ci', problem('nope')]]),
      isListed
    )
    expect(out.errors).toHaveLength(1)
  })

  it('drops a problem once its job is pinned to another machine, and keeps it while the job ticks here', () => {
    const problems = new Map([['ci', problem('nope')]])
    const pinned = (runsOn: string): LoadedDefinitions => ({
      ...loaded([]),
      definitions: [testDefinition({ id: 'ci', repo: 'nope', schedule: '10 * * * *', runsOn })]
    })
    const gate = runsOnGate({ machineName: () => 'Linux box', pinnedOnly: false })
    const errors = (runsOn: string) =>
      mergeRepoProblems(pinned(runsOn), problems, () => false, gate.ticksHere).errors
    expect(errors('Linux box')).toHaveLength(2)
    expect(errors('Mac mini')).toHaveLength(1)
  })

  it('leaves everything else as loaded', () => {
    const base = loaded(['ci'])
    expect(mergeRepoProblems(base, new Map(), () => false)).toEqual(base)
  })
})
