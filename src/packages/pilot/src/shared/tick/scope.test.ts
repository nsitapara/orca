import { describe, expect, it } from 'vitest'
import type { FieldValue, ScopeResult, TickItem } from '../api-types'
import type { MergeRequestWhere, PeopleRef } from '../definition/types'
import { parsePeopleYaml } from '../people'
import { authorScope, IN_SCOPE, mergeRequestListScope, mergeRequestScope } from './scope'

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

const CI: MergeRequestWhere = {
  state: 'open',
  author: { people: ['nish'] },
  head_pipeline: 'failed'
}
const REVIEW: MergeRequestWhere = {
  state: 'open',
  reviewer: { people: ['nish'] },
  author: { not: { people: ['nish'] } },
  approved_by: 'none'
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

describe('mergeRequestScope', () => {
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
      'a reviewer of the set',
      { reviewer: { people: ['nish'] } },
      { 'mr.reviewers': 'shivan2418,nish8' },
      IN_SCOPE
    ],
    [
      'a reviewer outside the set',
      { reviewer: { people: ['nish'] } },
      { 'mr.reviewers': 'shivan2418' },
      out('Reviewers: shivan2418; this automation looks at Nish Sitapara')
    ],
    [
      'no reviewers',
      { reviewer: { people: ['nish'] } },
      { 'mr.reviewers': '' },
      out('Reviewers: nobody; this automation looks at Nish Sitapara')
    ],
    [
      '09: a teammate MR waiting on me',
      REVIEW,
      { 'mr.author': 'shivan2418', 'mr.reviewers': 'nish8', 'mr.approved_by': '' },
      IN_SCOPE
    ],
    [
      '09: my own MR',
      REVIEW,
      { 'mr.reviewers': 'nish8', 'mr.approved_by': '' },
      out('Author is Nish Sitapara; this automation leaves out Nish Sitapara')
    ],
    [
      'another target',
      { target_branch: 'main' },
      { 'mr.target_branch': 'dev' },
      out('MR targets dev, not main')
    ],
    [
      'an unknown target',
      { target_branch: 'main' },
      { 'mr.target_branch': null },
      out('MR targets (unknown), not main')
    ],
    [
      'approved by me',
      { approved_by: 'none' },
      { 'mr.approved_by': 'nish8' },
      out('Approved by nish8')
    ],
    [
      'approved by others',
      { approved_by: 'none' },
      { 'mr.approved_by': 'shivan2418,alex1craig' },
      out('Approved by shivan2418, alex1craig')
    ],
    [
      'approvals unknown',
      { approved_by: 'none' },
      { 'mr.approved_by': null },
      out("Approvals couldn't be read")
    ],
    [
      'approved by a named person',
      { approved_by: { people: ['emil'] } },
      { 'mr.approved_by': 'shivan2418' },
      IN_SCOPE
    ],
    [
      'out of scope wins over not due',
      { state: 'open', head_pipeline: 'failed' },
      { 'mr.state': 'closed', 'mr.pipeline_status': 'running' },
      out('MR is closed')
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

describe('mergeRequestListScope', () => {
  const fields = {
    'mr.author': 'shivan2418',
    'mr.reviewers': 'nish8',
    'mr.approved_by': null,
    'mr.pipeline_status': null
  }

  it('decides from what the list response carries: approvals and the pipeline wait for the details', () => {
    const where: MergeRequestWhere = { ...REVIEW, head_pipeline: 'failed' }
    expect(mergeRequestListScope(mr(fields), where, people)).toEqual(IN_SCOPE)
    expect(mergeRequestScope(mr(fields), where, people)).toEqual(out("Approvals couldn't be read"))
  })

  it('rules an MR out on the list alone', () => {
    expect(mergeRequestListScope(mr({ ...fields, 'mr.author': 'nish8' }), REVIEW, people)).toEqual(
      out('Author is Nish Sitapara; this automation leaves out Nish Sitapara')
    )
  })
})
