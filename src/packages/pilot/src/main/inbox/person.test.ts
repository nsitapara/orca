import { describe, expect, it } from 'vitest'
import { parsePeopleYaml } from '../../shared/people'
import { resolveInboxPerson } from './person'

const parsed = parsePeopleYaml(
  'people:\n  - { id: nish, name: Nish, gitlab: nish8 }\n  - { id: emil, name: Emil, gitlab: shivan2418 }\ngroups:\n  - { id: web, name: Web, members: [nish, emil] }\n'
)
if (!parsed.ok) {
  throw new Error('setup')
}
const people = parsed.directory

describe('resolveInboxPerson', () => {
  it.each([
    ['nish', {}, { person: 'nish', routed: true }],
    ['web', {}, { person: 'web', routed: true }],
    ['{mr.author}', { 'mr.author': 'shivan2418' }, { person: 'emil', routed: true }],
    ['{mr.author}', { 'mr.author': '@NISH8' }, { person: 'nish', routed: true }],
    ['{mr.author}', { 'mr.author': 'stranger' }, { person: 'nish', routed: false }],
    ['{mr.author}', {}, { person: 'nish', routed: false }]
  ])('%s with %j', (template, fields, expected) => {
    expect(resolveInboxPerson(template, fields, people)).toEqual(expected)
  })
})

describe('resolveInboxPerson with nobody known', () => {
  it('returns no person instead of the raw string', () => {
    expect(
      resolveInboxPerson('{mr.author}', { 'mr.author': 'x' }, { people: [], groups: [] } as never)
    ).toEqual({ person: null, routed: false })
  })
})
