import { describe, expect, it } from 'vitest'
import type { ItemFields } from '../api-types'
import { linearTicketWhereSchema } from '../definition/where'
import type { PeopleDirectory } from '../people'
import { linearTicketScope } from './scope-linear'

const people: PeopleDirectory = {
  people: [
    { id: 'nish', name: 'Nish Sitapara', gitlab: 'nish8', linear: 'Nish' },
    { id: 'alex', name: 'Alex Craig', gitlab: 'alex1craig', linear: 'u-alex' }
  ],
  groups: []
}
const base: ItemFields = {
  'ticket.assignee': 'Nish',
  'ticket.assignee_id': 'u-nish',
  'ticket.state': 'Todo',
  'ticket.state_type': 'unstarted',
  'ticket.team': 'WEB',
  'ticket.team_name': 'Web Dev',
  'ticket.branch': 'web-1-fix-it'
}

describe('linearTicketScope', () => {
  it.each([
    ['M01: a Todo ticket with a branch', { state_type: ['unstarted'], has_branch: true }, {}, null],
    [
      'M01: no branch name in Linear',
      { has_branch: true },
      { 'ticket.branch': null },
      'No branch name in Linear'
    ],
    [
      'M01: not Todo',
      { state_type: ['unstarted'] },
      { 'ticket.state': 'Backlog', 'ticket.state_type': 'backlog' },
      'State is Backlog (backlog)'
    ],
    ['assigned to the named person', { assignee: { people: ['nish'] } }, {}, null],
    [
      'matched by Linear user id',
      { assignee: { people: ['alex'] } },
      { 'ticket.assignee': 'Alex C', 'ticket.assignee_id': 'u-alex' },
      null
    ],
    [
      'assigned to someone else',
      { assignee: { people: ['alex'] } },
      {},
      'Assignee is Nish Sitapara; this automation looks at Alex Craig'
    ],
    ['team by key or name', { team: 'web dev' }, {}, null],
    ['another team', { team: 'OPS' }, {}, 'Team is WEB']
  ] as [string, Record<string, unknown>, ItemFields, string | null][])(
    '%s',
    (_name, where, fields, want) => {
      const got = linearTicketScope(
        { ...base, ...fields },
        linearTicketWhereSchema.parse(where),
        people
      )
      expect(got.ok ? null : got.reason).toBe(want)
    }
  )
})
