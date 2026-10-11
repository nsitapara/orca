import { describe, expect, it } from 'vitest'
import type { PeopleRef } from './definition/types'
import {
  describeRef,
  gitlabHandlesFor,
  parsePeopleYaml,
  personByGitlab,
  refIncludes
} from './people'

const YAML = `
people:
  - { id: nish, name: Nish Sitapara, gitlab: nish8, github: nsitapara }
  - { id: shivan, name: Shivan, gitlab: shivan2418 }
groups:
  - { id: web, name: Web team, members: [nish, shivan] }
`

function errorsOf(text: string): string[] {
  const result = parsePeopleYaml(text)
  if (result.ok) {
    throw new Error('expected validation to fail')
  }
  return result.errors
}

describe('people', () => {
  const parsed = parsePeopleYaml(YAML)
  if (!parsed.ok) {
    throw new Error(parsed.errors.join('\n'))
  }
  const dir = parsed.directory

  it('finds a person by GitLab username, ignoring case', () => {
    expect(personByGitlab(dir, 'nish8')?.id).toBe('nish')
    expect(personByGitlab(dir, 'Nish8')?.id).toBe('nish')
    expect(personByGitlab(dir, 'someone')).toBeNull()
  })

  it.each([
    [undefined, 'shivan', true],
    ['anyone' as const, 'shivan', true],
    [{ people: ['nish'] }, 'nish', true],
    [{ people: ['nish'] }, 'shivan', false],
    [{ group: 'web' }, 'shivan', true],
    [{}, 'nish', false]
  ])('refIncludes(%o, %s) = %s', (ref, id, expected) => {
    expect(refIncludes(ref, id, dir)).toBe(expected)
  })

  it('describes a ref in plain words', () => {
    expect(describeRef({ people: ['nish'] }, dir)).toBe('Nish Sitapara')
    expect(describeRef({ people: ['nish', 'shivan'] }, dir)).toBe('Nish Sitapara and Shivan')
    expect(describeRef({ group: 'web' }, dir)).toBe('Web team')
    expect(describeRef({ people: ['nish'], group: 'web' }, dir)).toBe('Nish Sitapara and Web team')
    expect(describeRef({}, dir)).toBe('nobody')
    expect(describeRef('anyone', dir)).toBe('anyone')
  })

  it('rejects unknown keys and duplicate ids', () => {
    const bad = parsePeopleYaml(
      'people:\n  - { id: a, name: A, gitlabb: x }\n  - { id: a, name: B }\n'
    )
    expect(bad.ok).toBe(false)
  })

  it('names the unknown key in the error', () => {
    const bad = parsePeopleYaml('people:\n  - { id: a, name: A, gitlabb: x }\n')
    expect(bad.ok).toBe(false)
    if (!bad.ok) {
      expect(bad.errors.join('\n')).toMatch(/gitlabb/)
    }
  })

  it('returns malformed YAML as an error value instead of throwing', () => {
    const bad = parsePeopleYaml('people: [ { id: a, name: A\n')
    expect(bad.ok).toBe(false)
  })

  it.each([
    [
      'a group member that is not a person',
      'groups:\n  - { id: devs, name: Devs, members: [nish, shivn] }',
      'groups.devs: unknown member "shivn"'
    ],
    [
      'a group id used as a member (no nesting)',
      'groups:\n  - { id: devs, name: Devs, members: [web] }',
      'groups.devs: unknown member "web"'
    ]
  ])('rejects %s', (_label, groups, expected) => {
    const text = `people:\n  - { id: nish, name: Nish }\n  - { id: shivan, name: Shivan }\n${groups}\n  - { id: web, name: Web, members: [nish] }\n`
    expect(errorsOf(text)).toContain(expected)
  })

  it.each([
    ['gitlab', 'nish8', 'Nish8'],
    ['github', 'nsitapara', 'NSitapara'],
    ['linear', 'nish', 'NISH'],
    ['slack', 'U123', 'u123']
  ])('rejects a duplicate %s account across people, ignoring case', (field, first, second) => {
    const text = `people:\n  - { id: a, name: A, ${field}: ${first} }\n  - { id: b, name: B, ${field}: ${second} }\n`
    expect(errorsOf(text)).toContain(`people.b.${field}: "${second}" is also used by a`)
  })

  const notCases: [PeopleRef, string, boolean][] = [
    [{ not: { people: ['nish'] } }, 'nish', false],
    [{ not: { people: ['nish'] } }, 'shivan', true],
    [{ not: { group: 'web' } }, 'shivan', false],
    [{ not: {} }, 'nish', true]
  ]
  it.each(notCases)('refIncludes(%o, %s) = %s for a not ref', (ref, id, expected) => {
    expect(refIncludes(ref, id, dir)).toBe(expected)
  })

  it('describes a not ref as everyone but the people it names', () => {
    expect(describeRef({ not: { people: ['nish'] } }, dir)).toBe('anyone but Nish Sitapara')
    expect(describeRef({ not: { group: 'web' } }, dir)).toBe('anyone but Web team')
  })

  it('asks GitLab for every author under a not ref, so the filter runs after listing', () => {
    expect(gitlabHandlesFor({ not: { people: ['nish'] } }, dir)).toBeNull()
  })
})
