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
  automations: [{ id: 'ci', name: 'Fix failed CI on my MRs' }],
  runLines: { in_push: 'push · worktree path /wt/web-1493 · branch web-1493-a' }
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

  it("shows Pilot's Run line on an action card, and none on a question", async () => {
    serve()
    render(<WaitingOnYouPage />)
    const line = await screen.findByText('push · worktree path /wt/web-1493 · branch web-1493-a')
    expect(line.closest('article')?.textContent).toContain("Push !1561's 2 commits to origin?")
    expect(line.parentElement?.textContent).toMatch(/^Run:/)
    const question = screen.getByText('Install LibreOffice in the job?').closest('article')
    expect(question?.textContent).not.toContain('Run:')
  })

  it("labels Pilot's own re-asks Pilot: and the agent's replies Agent asked:", async () => {
    const asked = card({
      id: 'in_r',
      title: 'Which image?',
      replies: [
        'Approve actions in Pilot on this Mac',
        'The card changed after you approved it; approve the version shown now.',
        'Sent to the session before Pilot took over. Tick it (pilot inbox tick) once the session is done.',
        'e2e or unit?'
      ]
    })
    serve({ ...LIST, items: [asked] })
    render(<WaitingOnYouPage />)
    expect(await screen.findByText('Pilot: Approve actions in Pilot on this Mac')).toBeTruthy()
    expect(screen.getByText(/^Pilot: The card changed after you approved it/)).toBeTruthy()
    expect(screen.getByText(/^Pilot: Sent to the session before Pilot took over/)).toBeTruthy()
    expect(screen.getByText('Agent asked: e2e or unit?')).toBeTruthy()
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

  it('keeps the save error when the reload brings the card back as a new version', async () => {
    let version = 1
    pilotRpc.mockImplementation(async (method: string) => {
      if (method === 'pilot.inbox.answer') {
        version = 2
        throw new Error('The card changed; review it again')
      }
      if (method === 'pilot.inbox.list') {
        return { ...LIST, items: [{ ...QUESTION, version, digest: `d${version}` }] }
      }
      return { entries: [] }
    })
    render(<WaitingOnYouPage />)
    const article = (await screen.findByText('Install LibreOffice in the job?')).closest('article')!
    fireEvent.click(article.querySelector('input[value="Bake it"]')!)
    fireEvent.click(article.querySelector('button[data-save]')!)
    expect(await screen.findByText('The card changed; review it again')).toBeTruthy()
    await waitFor(() => expect(version).toBe(2))
    expect(screen.getByText('The card changed; review it again')).toBeTruthy()
  })

  it('sends Approve with notes on an ask-first card as "approve: <notes>" with the digest', async () => {
    const ask = card({
      id: 'in_ask',
      type: 'action',
      title: 'Prepare a review of !1588?',
      action: 'start_run',
      actionArgs: { run_id: 'r' },
      digest: 'da',
      options: [
        { label: 'Approve', meaning: 'start it now' },
        { label: 'Skip', meaning: 'nothing starts' }
      ]
    })
    serve({ ...LIST, items: [ask] }, [])
    render(<WaitingOnYouPage />)
    const article = (await screen.findByText('Prepare a review of !1588?')).closest('article')!
    fireEvent.click(article.querySelector('input[value="Approve with notes…"]')!)
    fireEvent.change(article.querySelector('textarea')!, {
      target: { value: 'use the second fix' }
    })
    fireEvent.click(article.querySelector('button[data-save]')!)
    await waitFor(() =>
      expect(pilotRpc).toHaveBeenCalledWith(
        'pilot.inbox.answer',
        expect.objectContaining({ id: 'in_ask', text: 'approve: use the second fix', digest: 'da' })
      )
    )
  })

  it('previews the vault import, then applies it from the page, and reloads', async () => {
    const report = {
      applied: false,
      imported: 3,
      answers: 1,
      runs: 2,
      skipped: [{ summary: 'Old?', reason: 'already imported' }]
    }
    pilotRpc.mockImplementation(async (method: string, params: { apply?: boolean }) => {
      if (method === 'pilot.inbox.importVault') {
        return { ...report, applied: params.apply === true }
      }
      return method === 'pilot.inbox.list' ? LIST : { entries: [] }
    })
    render(<WaitingOnYouPage />)
    fireEvent.click(await screen.findByRole('button', { name: 'Import open vault cards' }))
    expect(
      await screen.findByText('Would import 3 card(s), 1 with an answer; 1 skipped.')
    ).toBeTruthy()
    expect(screen.getByText(/Skipped “Old\?”: already imported/)).toBeTruthy()
    expect(pilotRpc.mock.calls.filter((c) => c[0] === 'pilot.inbox.importVault')).toHaveLength(1)
    fireEvent.click(screen.getByRole('button', { name: 'Apply import' }))
    expect(await screen.findByText('Imported 3 card(s), 1 with an answer; 1 skipped.')).toBeTruthy()
    const calls = pilotRpc.mock.calls.filter((c) => c[0] === 'pilot.inbox.importVault')
    expect(calls.map((c) => c[1])).toEqual([{ apply: false }, { apply: true }])
  })

  it('says why when the import is refused', async () => {
    pilotRpc.mockImplementation(async (method: string) => {
      if (method === 'pilot.inbox.importVault') {
        throw new Error("Pilot can't tell who is calling; nothing was imported")
      }
      return method === 'pilot.inbox.list' ? LIST : { entries: [] }
    })
    render(<WaitingOnYouPage />)
    fireEvent.click(await screen.findByRole('button', { name: 'Import open vault cards' }))
    expect(await screen.findByText(/nothing was imported/)).toBeTruthy()
  })
})
