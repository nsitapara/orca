// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { InboxItemRow } from '../../../shared/api-types'
import type { InboxListPayload, QueueEntry } from '../../../shared/inbox-types'

const pilotRpc = vi.fn()
vi.mock('../../api', () => ({ pilotRpc: (...args: unknown[]) => pilotRpc(...args) }))

import { WaitingOnYouPage } from './WaitingOnYouPage'

function card(over: Partial<InboxItemRow>): InboxItemRow {
  return {
    id: 'in_1',
    automationId: 'ci',
    runId: 'r',
    stepIdx: 0,
    itemKey: 'mr:1',
    worktreePath: '/wt/web-1493',
    person: 'nish',
    type: 'question',
    title: 't',
    context: '',
    options: [],
    suggested: null,
    detailsMd: null,
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
const PUSH = card({
  id: 'in_push',
  type: 'action',
  title: "Push !1561's 2 commits to origin?",
  context: 'Fixed the flaky spec.',
  suggested: 'Approve',
  action: 'push',
  actionArgs: { argv: ['a'] },
  digest: 'dp',
  detailsMd: '```diff\n-a\n+b\n```',
  options: [
    { label: 'Approve', meaning: 'push them to origin' },
    { label: 'Skip', meaning: 'keep them local' }
  ]
})
const QUESTION = card({
  id: 'in_q',
  title: 'Install LibreOffice in the job?',
  worktreePath: '/wt/web-2118',
  options: [
    { label: 'Install in the job', meaning: '~67 s per run' },
    { label: 'Bake it', meaning: '' }
  ]
})
const DEFAULT = card({
  id: 'in_d',
  type: 'default',
  title: 'Unit test files named after their module',
  options: [{ label: 'Keep', meaning: '' }]
})
const LIST: InboxListPayload = {
  items: [PUSH, QUESTION, DEFAULT],
  people: [
    { id: 'nish', name: 'Nish Sitapara' },
    { id: 'emil', name: 'Emil Elgaard' }
  ],
  groups: [],
  automations: [{ id: 'ci', name: 'Fix failed CI on my MRs' }]
}
const HELD: QueueEntry = {
  rowId: 1,
  itemId: 'in_x',
  title: 'Post your review of !1588?',
  type: 'action',
  automationId: 'ci',
  automationName: 'Fix failed CI on my MRs',
  worktreePath: '/wt/web-2115',
  person: 'nish',
  answer: 'approve',
  state: 'held',
  holdReason: 'typing',
  holdDetail: 'someone is typing in Claude · review',
  readyAt: 0,
  how: 'script',
  fires: 'Run post_review; no agent',
  updatedAt: 0
}

function serve(list = LIST, queue: QueueEntry[] = [HELD]) {
  pilotRpc.mockImplementation(async (method: string) => {
    if (method === 'pilot.inbox.list') {
      return list
    }
    if (method === 'pilot.queue.list') {
      return { entries: queue }
    }
    return { status: 'answered' }
  })
}

describe('WaitingOnYouPage', () => {
  afterEach(() => {
    cleanup()
    pilotRpc.mockReset()
  })

  it('shows the cards waiting, folds the defaults, and lists what saved answers set off', async () => {
    serve()
    render(<WaitingOnYouPage />)
    expect(await screen.findByText("Push !1561's 2 commits to origin?")).toBeTruthy()
    expect(screen.getByText('Install LibreOffice in the job?')).toBeTruthy()
    expect(screen.getByText('Defaults the agents took · 1')).toBeTruthy()
    expect(screen.getByText('Up next from your answers · 1')).toBeTruthy()
    expect(screen.getByText(/someone is typing in Claude · review/)).toBeTruthy()
    expect(screen.getByRole('button', { name: /All worktrees/ }).textContent).toContain('2')
  })

  it('loads the cards of the person you view as', async () => {
    serve()
    render(<WaitingOnYouPage />)
    fireEvent.click(await screen.findByRole('button', { name: 'Emil Elgaard' }))
    await waitFor(() =>
      expect(pilotRpc).toHaveBeenCalledWith('pilot.inbox.list', { person: 'emil' })
    )
  })

  it('saves Approve against the version shown', async () => {
    serve()
    render(<WaitingOnYouPage />)
    const article = (await screen.findByText("Push !1561's 2 commits to origin?")).closest(
      'article'
    )!
    fireEvent.click(article.querySelector('input[value="Approve"]')!)
    fireEvent.click(article.querySelector('button[data-save]')!)
    await waitFor(() =>
      expect(pilotRpc).toHaveBeenCalledWith(
        'pilot.inbox.answer',
        expect.objectContaining({ id: 'in_push', text: 'approve', option: 0, digest: 'dp' })
      )
    )
    // The caller kind and `via` are the server's to derive, never the page's.
    const sent = pilotRpc.mock.calls.find((c) => c[0] === 'pilot.inbox.answer')![1]
    expect(sent).not.toHaveProperty('via')
  })

  it('needs notes before it saves a revision', async () => {
    serve()
    render(<WaitingOnYouPage />)
    const article = (await screen.findByText("Push !1561's 2 commits to origin?")).closest(
      'article'
    )!
    fireEvent.click(article.querySelector('input[value="Revise…"]')!)
    const save = article.querySelector('button[data-save]') as HTMLButtonElement
    expect(save.disabled).toBe(true)
    fireEvent.change(article.querySelector('textarea')!, { target: { value: 'push only the fix' } })
    fireEvent.click(save)
    await waitFor(() =>
      expect(pilotRpc).toHaveBeenCalledWith(
        'pilot.inbox.answer',
        expect.objectContaining({ id: 'in_push', text: 'revise: push only the fix' })
      )
    )
  })

  it('says so when the card changed before the answer was saved', async () => {
    serve()
    pilotRpc.mockImplementation(async (method: string) => {
      if (method === 'pilot.inbox.answer') {
        throw new Error('The card changed; review it again')
      }
      return method === 'pilot.inbox.list' ? LIST : { entries: [] }
    })
    render(<WaitingOnYouPage />)
    const article = (await screen.findByText('Install LibreOffice in the job?')).closest('article')!
    fireEvent.click(article.querySelector('input[value="Bake it"]')!)
    fireEvent.click(article.querySelector('button[data-save]')!)
    expect(await screen.findByText('The card changed; review it again')).toBeTruthy()
  })
})
