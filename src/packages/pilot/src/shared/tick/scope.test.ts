import { describe, expect, it } from 'vitest'
import type { FieldValue, ScopeResult, TickItem } from '../api-types'
import type { MergeRequestWhere, PeopleRef } from '../definition/types'
import { parsePeopleYaml } from '../people'
import { authorScope, IN_SCOPE, mergeRequestScope } from './scope'

const parsed = parsePeopleYaml(`
people:
  - { id: nish, name: Nish Sitapara, gitlab: nish8 }
  - { id: emil, name: Emil Elgaard, gitlab: shivan2418 }
groups:
  - { id: web, name: Web team, members: [nish, emil] }
`)
if (!parsed.ok) {
  throw new Error(parsed.errors.join('\n'))
}
const people = parsed.directory
const out = (reason: string): ScopeResult => ({ ok: false, verdict: 'out_of_scope', reason })

describe('authorScope', () => {
  const cases: [string, PeopleRef | undefined, string, ScopeResult][] = [
    ['no author clause', undefined, 'stranger', IN_SCOPE],
    ['anyone', 'anyone', 'stranger', IN_SCOPE],
    ['a listed person, in any case', { people: ['nish'] }, 'NISH8', IN_SCOPE],
    [
      'another person',
      { people: ['nish'] },
      'shivan2418',
      out('Author is Emil Elgaard; this automation looks at Nish Sitapara')
    ],
    [
      'someone people.yaml lacks',
      { people: ['nish'] },
      'stranger',
      out("Author stranger isn't in people.yaml")
    ],
    ['a group member', { group: 'web' }, 'shivan2418', IN_SCOPE],
    [
      'a person a not ref leaves out',
      { not: { people: ['nish'] } },
      'nish8',
      out('Author is Nish Sitapara; this automation leaves out Nish Sitapara')
    ],
    ['someone else under a not ref', { not: { people: ['nish'] } }, 'shivan2418', IN_SCOPE],
    [
      'someone people.yaml lacks under a not ref',
      { not: { group: 'web' } },
      'contractor9',
      IN_SCOPE
    ],
    ['stranger under not: people', { not: { people: ['nish'] } }, 'stranger', IN_SCOPE]
  ]
  it.each(cases)('%s', (_label, ref, username, expected) => {
    expect(authorScope(ref, username, people)).toEqual(expected)
  })
})

describe('mergeRequestScope', () => {
  const CI: MergeRequestWhere = {
    state: 'open',
    author: { people: ['nish'] },
    head_pipeline: 'failed'
  }
  const mr = (fields: Record<string, FieldValue>): TickItem => ({
    key: 'mr:1',
    label: '!1 x',
    fields: {
      'mr.state': 'open',
      'mr.author': 'nish8',
      'mr.draft': false,
      'mr.pipeline_status': 'failed',
      ...fields
    }
  })
  const cases: [string, MergeRequestWhere, Record<string, FieldValue>, ScopeResult][] = [
    ["an open MR of nish's with a failed pipeline", CI, {}, IN_SCOPE],
    ['a merged MR', CI, { 'mr.state': 'merged' }, out('MR is merged')],
    ['an MR without a state', CI, { 'mr.state': null }, out('MR is (state unknown)')],
    [
      "a teammate's MR",
      CI,
      { 'mr.author': 'shivan2418' },
      out('Author is Emil Elgaard; this automation looks at Nish Sitapara')
    ],
    [
      'an MR without an author',
      CI,
      { 'mr.author': null },
      out("Author (unknown) isn't in people.yaml")
    ],
    [
      'a running pipeline',
      CI,
      { 'mr.pipeline_status': 'running' },
      { ok: false, verdict: 'notdue', reason: 'Head pipeline running' }
    ],
    [
      'no pipeline',
      CI,
      { 'mr.pipeline_status': null },
      { ok: false, verdict: 'notdue', reason: 'Head pipeline missing' }
    ],
    ['any pipeline', { head_pipeline: 'any' }, { 'mr.pipeline_status': 'success' }, IN_SCOPE],
    [
      'a draft when drafts are left out',
      { draft: false },
      { 'mr.draft': true },
      out('MR is a draft')
    ],
    ['a ready MR when only drafts count', { draft: true }, {}, out("MR isn't a draft")],
    [
      'a reviewer clause',
      { reviewer: { people: ['nish'] } },
      {},
      out("Pilot doesn't read MR reviewers yet, so where.reviewer can't be checked")
    ],
    [
      'an approvals clause',
      { approved_by: 'none' },
      {},
      out("Pilot doesn't read MR approvals yet, so where.approved_by can't be checked")
    ],
    [
      'a target branch clause',
      { target_branch: 'dev' },
      {},
      out("Pilot doesn't read MR target branches yet, so where.target_branch can't be checked")
    ],
    [
      'a stranger under a not author ref',
      { author: { not: { people: ['nish'] } } },
      { 'mr.author': 'stranger' },
      IN_SCOPE
    ]
  ]
  it.each(cases)('%s', (_label, where, fields, expected) => {
    expect(mergeRequestScope(mr(fields), where, people)).toEqual(expected)
  })

  it('reads a missing people.yaml as an empty one', () => {
    expect(mergeRequestScope(mr({}), CI, null)).toEqual(out("Author nish8 isn't in people.yaml"))
  })
})
