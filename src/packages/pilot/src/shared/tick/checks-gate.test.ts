import { describe, expect, it } from 'vitest'
import type { ItemFields } from '../api-types'
import { gateCheckOutcome, mrOutcome, sessionOutcome, type MrRule } from './checks-gate'

describe('mrOutcome', () => {
  it.each([
    [
      'not_approved',
      { 'mr.review_block': '' },
      true,
      'Mine, not merged or closed, and not approved'
    ],
    [
      'not_approved',
      { 'mr.review_block': '!1577 approved by alex1craig' },
      false,
      '!1577 approved by alex1craig'
    ],
    ['not_merged', { 'mr.finished_block': '!1453 merged' }, false, '!1453 merged'],
    ['mine', { 'mr.owner_block': "!1588 is shivan2418's MR" }, false, "!1588 is shivan2418's MR"],
    ['mine', { 'mr.owner_block': '' }, true, 'Mine (or no MR yet)'],
    ['not_draft', { 'mr.draft_block': '!1590 is a draft' }, false, '!1590 is a draft'],
    ['not_draft', {}, false, "Couldn't read the branch's merge requests"],
    ['not_approved', {}, false, "Couldn't read the branch's merge requests"],
    [
      'not_approved',
      { 'mr.review_block': null },
      false,
      "Couldn't read the branch's merge requests"
    ],
    ['not_merged', {}, false, "Couldn't read the branch's merge requests"],
    [
      'not_merged',
      { 'mr.finished_block': null },
      false,
      "Couldn't read the branch's merge requests"
    ],
    ['mine', {}, false, "Couldn't read the branch's merge requests"],
    ['mine', { 'mr.owner_block': null }, false, "Couldn't read the branch's merge requests"],
    ['not_draft', { 'mr.draft_block': null }, false, "Couldn't read the branch's merge requests"],
    ['not_draft', { 'mr.draft_block': '' }, true, 'Not a draft'],
    ['not_merged', { 'mr.finished_block': '' }, true, 'Not merged or closed']
  ] as [MrRule, ItemFields, boolean, string][])('%s with %j', (rule, fields, ok, reason) => {
    expect(mrOutcome(rule, fields)).toEqual({ ok, reason })
  })

  it('refuses an unknown rule instead of passing', () => {
    expect(mrOutcome('whatever' as MrRule, { 'mr.draft_block': '' }).ok).toBe(false)
  })
})

describe('sessionOutcome', () => {
  it.each([
    [
      'automation',
      { 'session.open_from_automation': true },
      false,
      'A session from this automation is still open there'
    ],
    ['automation', { 'session.open_from_automation': false }, true, 'No session open'],
    [
      'any',
      { 'session.open_any': true },
      false,
      'A session from an automation is still open there'
    ],
    ['any', { 'session.open_any': false }, true, 'No session open'],
    ['any', {}, false, "Couldn't tell whether a session is open"]
  ] as ['automation' | 'any', ItemFields, boolean, string][])(
    '%s with %j',
    (scope, fields, ok, reason) => {
      expect(sessionOutcome(scope, fields)).toEqual({ ok, reason })
    }
  )

  it('gateCheckOutcome routes each kind', () => {
    expect(
      gateCheckOutcome({ kind: 'session_none_open', scope: 'any' }, { 'session.open_any': false })
        .ok
    ).toBe(true)
    expect(gateCheckOutcome({ kind: 'mr', rule: 'mine' }, { 'mr.owner_block': '' }).ok).toBe(true)
  })
})
