import type { InboxListRow } from '../../../shared/api-types'

export function inboxRow(over: Partial<InboxListRow> = {}): InboxListRow {
  return {
    id: 'in_1',
    automationId: 'tests',
    runId: 'r1',
    stepIdx: 0,
    itemKey: null,
    worktreePath: null,
    person: 'nish',
    type: 'question',
    title: 't',
    context: '',
    options: [],
    suggested: null,
    detailsMd: null,
    details: null,
    action: null,
    actionArgs: null,
    parts: {},
    switchWords: [],
    digest: 'd1',
    version: 1,
    status: 'open',
    answer: null,
    answeredAt: null,
    answeredBy: null,
    replies: [],
    outcome: null,
    createdAt: 1,
    updatedAt: 1,
    source: 'engine',
    vaultRef: null,
    ...over
  }
}
