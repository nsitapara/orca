import { describe, expect, it } from 'vitest'
import type { PeopleRef } from './definition/types'
import { matchRef, matchRefAny, personByAccount, type PeopleDirectory } from './people'

const dir: PeopleDirectory = {
  people: [
    { id: 'nish', name: 'Nish Sitapara', gitlab: 'nish8', github: 'nsitapara', linear: 'Nish' },
    { id: 'emil', name: 'Emil Elgaard', gitlab: 'shivan2418' },
    { id: 'alex', name: 'Alex Craig', gitlab: 'alex1craig' }
  ],
  groups: [{ id: 'web', name: 'Web team', members: ['nish', 'emil', 'alex'] }]
}
const notNish: PeopleRef = { not: { people: ['nish'] } }

describe('personByAccount', () => {
  it.each([
    ['gitlab', 'NISH8', 'nish'],
    ['github', 'nsitapara', 'nish'],
    ['linear', 'nish', 'nish'],
    ['linear', 'Emil', null]
  ] as const)('%s %s -> %s', (account, handle, want) => {
    expect(personByAccount(dir, account, handle)?.id ?? null).toBe(want)
  })
})

it('finds nobody by an empty handle, even beside an empty account', () => {
  const blank: PeopleDirectory = { people: [{ id: 'bot', name: 'Bot', slack: '' }], groups: [] }
  expect(personByAccount(blank, 'slack', '')).toBeNull()
})

// M1's author reasons stay; a not-ref is 09's "author: { not: me }" (sweep.py plan: "your own MR").
describe('matchRef', () => {
  it.each([
    ['anyone, unknown handle', 'anyone', 'stranger', null],
    ['in the set, any case', { people: ['nish'] }, 'NISH8', null],
    [
      'not in people.yaml',
      { people: ['nish'] },
      'stranger',
      "Author stranger isn't in people.yaml"
    ],
    [
      'someone else',
      { people: ['nish'] },
      'shivan2418',
      'Author is Emil Elgaard; this automation looks at Nish Sitapara'
    ],
    [
      'not-ref: my own MR',
      notNish,
      'nish8',
      'Author is Nish Sitapara; this automation leaves out Nish Sitapara'
    ],
    ['not-ref: a teammate', notNish, 'shivan2418', null],
    ['not-ref: someone people.yaml does not know', notNish, 'stranger', null],
    ['no handle', { people: ['nish'] }, null, 'Author is unknown']
  ] as [string, PeopleRef, string | null, string | null][])('%s', (_name, ref, handle, reason) => {
    const got = matchRef(ref, 'Author', 'gitlab', handle, dir)
    expect(got.ok ? null : got.reason).toBe(reason)
  })
})

describe('matchRefAny', () => {
  it.each([
    ['a set needs one of them', { people: ['nish'] }, ['alex1craig', 'nish8'], null],
    [
      'a set with none of them',
      { people: ['nish'] },
      ['alex1craig'],
      'Reviewers: alex1craig; this automation looks at Nish Sitapara'
    ],
    [
      'a set with nobody',
      { people: ['nish'] },
      [],
      'Reviewers: nobody; this automation looks at Nish Sitapara'
    ],
    [
      'a not-ref with one of them',
      notNish,
      ['alex1craig', 'nish8'],
      'Reviewers: Nish Sitapara; this automation leaves out Nish Sitapara'
    ],
    ['a not-ref with nobody', notNish, [], null]
  ] as [string, PeopleRef, string[], string | null][])('%s', (_name, ref, handles, reason) => {
    const got = matchRefAny(ref, 'Reviewers', 'gitlab', handles, dir)
    expect(got.ok ? null : got.reason).toBe(reason)
  })
})
