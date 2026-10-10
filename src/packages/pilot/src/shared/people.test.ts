import { describe, expect, it } from 'vitest'
import { describeRef, parsePeopleYaml, personByGitlab, refIncludes } from './people'

const YAML = `
people:
  - { id: nish, name: Nish Sitapara, gitlab: nish8, github: nsitapara }
  - { id: shivan, name: Shivan, gitlab: shivan2418 }
groups:
  - { id: web, name: Web team, members: [nish, shivan] }
`

describe('people', () => {
  const parsed = parsePeopleYaml(YAML)
  if (!parsed.ok) {
    throw new Error(parsed.errors.join('\n'))
  }
  const dir = parsed.directory

  it('finds a person by GitLab username', () => {
    expect(personByGitlab(dir, 'nish8')?.id).toBe('nish')
    expect(personByGitlab(dir, 'someone')).toBeNull()
  })

  it.each([
    [undefined, 'shivan', true],
    ['anyone' as const, 'shivan', true],
    [{ people: ['nish'] }, 'nish', true],
    [{ people: ['nish'] }, 'shivan', false],
    [{ group: 'web' }, 'shivan', true]
  ])('refIncludes(%o, %s) = %s', (ref, id, expected) => {
    expect(refIncludes(ref, id, dir)).toBe(expected)
  })

  it('describes a ref in plain words', () => {
    expect(describeRef({ people: ['nish'] }, dir)).toBe('Nish Sitapara')
    expect(describeRef({ people: ['nish', 'shivan'] }, dir)).toBe('Nish Sitapara and Shivan')
    expect(describeRef({ group: 'web' }, dir)).toBe('Web team')
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
})
