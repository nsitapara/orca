import { describe, expect, it } from 'vitest'
import type { InboxItemRow, InboxReply } from '../../shared/api-types'
import type { CardHistoryEntry } from '../../shared/inbox-types'
import { queuedPreparation } from '../../shared/preparation'
import { PilotStore } from '../store/store'
import type { NewInboxItem } from '../store/store-inbox'
import { cardHistories } from './card-history'
import { inboxEvent } from './inbox-service'

const card = (id: string, extra: Partial<NewInboxItem> = {}): NewInboxItem => ({
  id,
  automationId: 'review',
  runId: 'r1',
  stepIdx: 1,
  itemKey: 'mr:1653',
  worktreePath: '/wt/vite-plus-spike',
  person: 'nish',
  type: 'left_for_you',
  title: 'Point the CRM e2e runner at vp?',
  context: '',
  options: [],
  suggested: null,
  detailsMd: null,
  action: null,
  actionArgs: null,
  digest: 'd1',
  createdAt: 100,
  source: 'engine',
  vaultRef: null,
  ...extra
})

type Step =
  | { event: string; at: number; payload?: Record<string, unknown> }
  | { answerRun: string; at: number; items: string[] }
  | { replies: InboxReply[] }
  | { preparedBy: string }

function historyOf(over: Partial<NewInboxItem>, steps: Step[]): CardHistoryEntry[] {
  const store = PilotStore.open(':memory:')
  const run = (id: string, status: 'failed' | 'done') =>
    store.runs.create({
      id,
      automationId: 'review',
      tickId: null,
      itemKey: 'mr:1653',
      itemLabel: 'vite-plus-spike',
      worktreePath: null,
      startedAt: 1,
      status
    })
  run('r1', 'failed')
  run('ans-1', 'done')
  store.inbox.add(card('in_1', over))
  store.inbox.add(card('in_2', { title: 'Drop clearMocks?' }))
  const item = (): InboxItemRow => store.inbox.get('in_1')!
  for (const step of steps) {
    if ('event' in step) {
      inboxEvent(store, item(), step.event, step.payload ?? {}, step.at)
    } else if ('answerRun' in step) {
      const payload = { answer: 'a', items: step.items }
      store.events.add({ at: step.at, runId: step.answerRun, kind: 'answer_run', payload })
    } else if ('replies' in step) {
      store.inbox.update('in_1', { replies: step.replies }, 1)
    } else {
      const ready = { ...queuedPreparation(PREP, 1), state: 'ready' as const }
      store.inboxPreparations.write('in_1', { ...ready, runId: step.preparedBy })
    }
  }
  const history = cardHistories(store, [item()])['in_1']
  store.close()
  return history
}

const PREP = { key: 'k', context: 'c', requirements: ['context' as const] }
const NOTE = { text: 'might already be resolved?', via: 'page', option: null }
const R1 = { id: 'r1', status: 'failed' } as const
const ANS = { id: 'ans-1', status: 'done' } as const

describe('cardHistories', () => {
  it.each<[string, Partial<NewInboxItem>, Step[], CardHistoryEntry[]]>([
    [
      "your answer, the run it went to with the cards beside it, then the agent's reply",
      {},
      [
        { preparedBy: 'prep-1' },
        { event: 'item_updated', at: 200, payload: { reason: 'context_ready', attempt: 1 } },
        { event: 'answer_saved', at: 300, payload: NOTE },
        { answerRun: 'ans-1', at: 305, items: ['in_2', 'in_1'] },
        { event: 'answer_sent', at: 305, payload: { runId: 'ans-1', route: 'new' } },
        { event: 'item_replied', at: 400, payload: { text: 'Not resolved.' } },
        { replies: [{ text: 'Not resolved.', by: 'agent' }] }
      ],
      [
        { kind: 'asked', at: 100, run: R1 },
        { kind: 'prepared', at: 200, run: { id: 'prep-1', status: null } },
        {
          kind: 'answer',
          at: 300,
          text: 'might already be resolved?',
          option: null,
          run: ANS,
          with: ['Drop clearMocks?']
        },
        { kind: 'reply', at: 400, by: 'agent', text: 'Not resolved.', run: ANS }
      ]
    ],
    [
      'leaves out an answer you undid, and keeps the last words of one changed before it went',
      {},
      [
        { event: 'answer_saved', at: 300, payload: { text: 'approve', via: 'page', option: 0 } },
        { event: 'answer_cleared', at: 310 },
        { event: 'answer_saved', at: 320, payload: { ...NOTE, text: 'first' } },
        { event: 'answer_saved', at: 330, payload: { ...NOTE, text: 'second' } },
        { event: 'answer_sent', at: 340, payload: { runId: 'ans-1', route: 'new' } },
        { event: 'item_replied', at: 400, payload: { text: 'ok' } },
        { replies: [{ text: 'ok', by: 'agent' }] }
      ],
      [
        { kind: 'asked', at: 100, run: R1 },
        { kind: 'answer', at: 330, text: 'second', option: null, run: ANS, with: [] },
        { kind: 'reply', at: 400, by: 'agent', text: 'ok', run: ANS }
      ]
    ],
    [
      'shows a reply it has no event for first, without a time, and an answer never sent without a run',
      {},
      [
        { event: 'answer_saved', at: 300, payload: { ...NOTE, text: 'x' } },
        { event: 'item_reasked', at: 400, payload: { reason: 'Approve on this Mac' } },
        {
          replies: [
            { text: 'Imported line', by: 'pilot' },
            { text: 'Approve on this Mac', by: 'pilot' }
          ]
        }
      ],
      [
        { kind: 'asked', at: 100, run: R1 },
        { kind: 'reply', at: null, by: 'pilot', text: 'Imported line', run: null },
        { kind: 'answer', at: 300, text: 'x', option: null, run: null, with: [] },
        { kind: 'reply', at: 400, by: 'pilot', text: 'Approve on this Mac', run: null }
      ]
    ],
    [
      "puts Pilot's line where the card changed after you answered",
      {},
      [
        { event: 'answer_saved', at: 300, payload: { text: 'approve', via: 'page', option: 0 } },
        { event: 'item_updated', at: 350, payload: { version: 2, cleared: true } },
        { event: 'item_updated', at: 360, payload: { version: 3, reason: 'refresh' } },
        { replies: [{ text: 'The card changed after you answered.', by: 'pilot' }] }
      ],
      [
        { kind: 'asked', at: 100, run: R1 },
        { kind: 'answer', at: 300, text: 'approve', option: 0, run: null, with: [] },
        {
          kind: 'reply',
          at: 350,
          by: 'pilot',
          text: 'The card changed after you answered.',
          run: null
        }
      ]
    ],
    [
      "dates a Not prepared notice's reply to when the card was made, from no run",
      { runId: null, notPreparedKey: 'k', replies: [{ text: 'Not prepared: x', by: 'pilot' }] },
      [],
      [
        { kind: 'asked', at: 100, run: null },
        { kind: 'reply', at: 100, by: 'pilot', text: 'Not prepared: x', run: null }
      ]
    ]
  ])('%s', (_name, over, steps, want) => {
    expect(historyOf(over, steps)).toEqual(want)
  })
})
