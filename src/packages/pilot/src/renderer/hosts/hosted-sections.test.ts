import { describe, expect, it } from 'vitest'
import type { InboxListRow } from '../../shared/api-types'
import { LOCAL_NAMED, MINI } from './__fixtures__/hosts'
import { inboxRow } from './__fixtures__/inbox-row'
import { groupHostedItems } from './hosted-sections'
import { hostedKey, type Hosted, type PilotHostRef } from './pilot-host'

function card(
  host: PilotHostRef,
  worktreePath: string | null,
  automationId = 'tests'
): Hosted<InboxListRow> {
  return { ...inboxRow({ worktreePath, automationId }), host }
}

describe('groupHostedItems', () => {
  it('gives the same worktree path on two machines a section each (Review Focus 2)', () => {
    const s = groupHostedItems([card(LOCAL_NAMED, '/w/x'), card(MINI, '/w/x')], [])
    expect(s.map((x) => [x.key, x.host.key])).toEqual([
      ['wt:/w/x', 'local'],
      [hostedKey(MINI, 'wt:/w/x'), 'env:mini']
    ])
  })

  it('orders sections by kind, then name (numbers as numbers), then machine, each keeping its cards tagged', () => {
    const s = groupHostedItems(
      [
        card(LOCAL_NAMED, '/w/web-10'),
        card(MINI, null, 'ci'),
        card(MINI, '/w/web-10'),
        card(LOCAL_NAMED, '/w/web-9')
      ],
      [{ id: 'ci', name: 'Fix CI' }]
    )
    expect(s.map((x) => [x.key, x.items.map((i) => i.host.key)])).toEqual([
      ['wt:/w/web-9', ['local']],
      ['wt:/w/web-10', ['local']],
      ['env:mini/wt:/w/web-10', ['env:mini']],
      ['env:mini/job:ci', ['env:mini']]
    ])
  })
})
