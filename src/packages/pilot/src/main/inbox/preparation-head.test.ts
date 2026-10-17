import { describe, expect, it } from 'vitest'
import type { InboxItemRow } from '../../shared/api-types'
import { PreparationInputSchema } from '../../shared/preparation'
import { evidenceRequest } from './preparation'

const card = (over: Partial<InboxItemRow>): InboxItemRow =>
  ({
    id: 'in_1',
    type: 'action',
    title: 'Push the fix?',
    context: 'CI is green on the fix',
    suggested: null,
    options: [],
    action: null,
    actionArgs: null,
    details: null,
    worktreePath: '/wt/a',
    runId: 'r1',
    stepIdx: 0,
    ...over
  }) as InboxItemRow

describe("the preparation request's head", () => {
  it.each([
    ['a full sha', { head: 'a'.repeat(40) }, true],
    ['a short sha', { head: '9c1e2f0' }, true],
    ['no head', {}, true],
    ['a branch name', { head: 'main' }, false]
  ])('accepts %s: %s', (_name, extra, ok) => {
    const input = { key: 'k', context: 'c', requirements: ['context'], ...extra }
    expect(PreparationInputSchema.safeParse(input).success).toBe(ok)
  })

  it.each([
    [
      'a push card: the head it pins',
      'push',
      { argv: ['/wt/a', 'web-1', '9c1e2f0', '1a2b3c4'] },
      '9c1e2f0'
    ],
    ['a push card pinning no commit', 'push', { argv: ['/wt/a', 'web-1'] }, undefined],
    ['any other card: none', 'mark_ready', { argv: ['1577', '430f7e68'] }, undefined]
  ])('Pilot-built request, %s', (_name, action, actionArgs, head) => {
    expect(evidenceRequest(card({ action, actionArgs })).head).toBe(head)
  })
})
