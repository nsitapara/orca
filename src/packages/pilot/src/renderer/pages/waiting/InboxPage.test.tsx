// @vitest-environment happy-dom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { InboxItemRow } from '../../../shared/api-types'
import type { DetailsBundle, DetailsRef } from '../../../shared/details'
import type { InboxListPayload, QueueEntry } from '../../../shared/inbox-types'

const pilotRpc = vi.fn()
vi.mock('../../api', () => ({ pilotRpc: (...args: unknown[]) => pilotRpc(...args) }))

import { stepAt, testCard, testRun } from '../../../shared/run-views/__fixtures__/runs'
import { resetAutomationsFeed } from '../../run-views/automations-feed'
import { closeRunPanel, openRunPanel } from '../../run-views/run-panel-state'
import {
  pendingInboxCard,
  pilotAutomationsView,
  setPilotAutomationsView,
  showInboxCard
} from '../automations-view'
import { summary } from '../fixtures'
import { InboxPage } from './InboxPage'

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
  answerStates: {},
  runLines: {
    in_push: { digest: 'dp', text: 'python3 /a/act.py push run /wt/web-1493 web-1493-a' }
  }
}
const HELD: QueueEntry = {
  rowId: 1,
  itemId: 'in_x',
  title: 'Mark !1588 ready?',
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
  fires: 'Run mark_ready; no agent',
  updatedAt: 0
}

const choice = (from: ParentNode, value: string): Element =>
  from.querySelector(`[data-choice="${value}"]`)!

function serve(list = LIST, queue: QueueEntry[] = [HELD]) {
  pilotRpc.mockImplementation(async (method: string) => {
    if (method === 'pilot.inbox.list') {
      return list
    }
    if (method === 'pilot.queue.list') {
      return { entries: queue }
    }
    if (method === 'pilot.runs.doneForYou') {
      return []
    }
    return { status: 'answered' }
  })
}

describe('InboxPage', () => {
  afterEach(() => {
    cleanup()
    resetAutomationsFeed()
    pilotRpc.mockReset()
  })

  it('picks the card the run panel named, once the list has it, and forgets it', async () => {
    serve()
    showInboxCard('in_q')
    render(<InboxPage />)
    await screen.findByRole('heading', { name: 'Install LibreOffice in the job?' })
    await waitFor(() =>
      expect(document.getElementById('card-in_q')?.hasAttribute('data-selected')).toBe(true)
    )
    expect(pendingInboxCard()).toBeNull()
    setPilotAutomationsView('automations')
  })

  it('picks a card the run panel names while the Inbox is already open', async () => {
    serve()
    render(<InboxPage />)
    await screen.findByRole('heading', { name: 'Install LibreOffice in the job?' })
    act(() => showInboxCard('in_q'))
    await waitFor(() =>
      expect(document.getElementById('card-in_q')?.hasAttribute('data-selected')).toBe(true)
    )
    expect(pendingInboxCard()).toBeNull()
    setPilotAutomationsView('automations')
  })

  it('shows on each card the run it came from', async () => {
    const run = testRun({
      id: 'r',
      automationId: 'ci',
      itemLabel: '!1561',
      status: 'needs_you',
      steps: [stepAt(0, 'fix', 'done')],
      inbox: [testCard({ id: 'in_q', automationId: 'ci', runId: 'r', stepIdx: 0 })]
    })
    pilotRpc.mockImplementation(async (method: string) => {
      if (method === 'pilot.inbox.list') {
        return { ...LIST, runs: { r: run } }
      }
      if (method === 'pilot.queue.list') {
        return { entries: [] }
      }
      if (method === 'pilot.automations.list') {
        return {
          automations: [{ ...summary, id: 'ci' }],
          errors: [],
          peopleError: null,
          missingDirs: []
        }
      }
      return { status: 'answered' }
    })
    render(<InboxPage />)
    const card = await screen.findByRole('heading', { name: 'Install LibreOffice in the job?' })
    const article = card.closest('article') as HTMLElement
    expect(await within(article).findByText('!1561')).toBeTruthy()
    expect(within(article).getByText('From run')).toBeTruthy()
  })

  it('shows the cards waiting, folds the defaults, and opens In motion by itself on an answer held 20+ minutes', async () => {
    serve()
    render(<InboxPage />)
    expect(
      await screen.findByRole('heading', { name: "Push !1561's 2 commits to origin?" })
    ).toBeTruthy()
    expect(screen.getByRole('heading', { name: 'Install LibreOffice in the job?' })).toBeTruthy()
    expect(screen.getByText('Defaults without a run · 1')).toBeTruthy()
    expect(screen.getByText('Up next from your answers · 1')).toBeTruthy()
    expect(screen.getByText(/someone is typing in Claude · review/)).toBeTruthy()
    expect(screen.getByRole('button', { name: 'All · 2' })).toBeTruthy()
  })

  it("shows a run's default under it in Done for you, and Got it acknowledges the run", async () => {
    const def = LIST.items.find((i) => i.type === 'default')!
    pilotRpc.mockImplementation(async (method: string, params: unknown) => {
      if (method === 'pilot.inbox.list') {
        return LIST
      }
      if (method === 'pilot.runs.doneForYou') {
        return [
          {
            run: {
              ...testRun({ id: def.runId!, itemLabel: 'WEB-2176', status: 'done' }),
              fields: {}
            },
            effects: [],
            defaults: [testCard({ id: def.id, type: 'default' })]
          }
        ]
      }
      if (method === 'pilot.runs.acknowledge') {
        return {
          acknowledged: (params as { runIds: string[] }).runIds,
          kept: [def.id],
          notKept: []
        }
      }
      return method === 'pilot.queue.list' ? { entries: [] } : []
    })
    render(<InboxPage />)
    const section = await screen.findByRole('region', { name: 'Done for you' })
    expect(within(section).getByRole('heading', { name: def.title })).toBeTruthy()
    expect(screen.queryByText(/Defaults without a run/)).toBeNull()
    fireEvent.click(within(section).getByRole('button', { name: 'Got it: WEB-2176' }))
    await waitFor(() =>
      expect(pilotRpc).toHaveBeenCalledWith('pilot.runs.acknowledge', { runIds: [def.runId] })
    )
  })

  it("keeps LIST's default in the fold when a run's default isn't in the inbox list", async () => {
    pilotRpc.mockImplementation(async (method: string) => {
      if (method === 'pilot.inbox.list') {
        return LIST
      }
      if (method === 'pilot.runs.doneForYou') {
        return [
          {
            run: { ...testRun({ id: 'r9', itemLabel: 'WEB-9', status: 'done' }), fields: {} },
            effects: [],
            defaults: [testCard({ id: 'in_unknown', type: 'default' })]
          }
        ]
      }
      return method === 'pilot.queue.list' ? { entries: [] } : []
    })
    render(<InboxPage />)
    expect(await screen.findByText('Defaults without a run · 1')).toBeTruthy()
    expect(screen.getByRole('region', { name: 'Done for you' })).toBeTruthy()
  })

  it('folds what is running and what answers set off into one In motion line that opens on a click', async () => {
    const settling = { ...HELD, state: 'not_ready' as const, holdReason: null, holdDetail: null }
    pilotRpc.mockImplementation(async (method: string) => {
      if (method === 'pilot.inbox.list') {
        return LIST
      }
      if (method === 'pilot.automations.list') {
        const live = [testRun({ id: 'r1', automationId: 'ci', status: 'running' })]
        return {
          automations: [{ ...summary, id: 'ci', live }],
          errors: [],
          peopleError: null,
          missingDirs: []
        }
      }
      if (method === 'pilot.queue.list') {
        return { entries: [{ ...settling, readyAt: Date.now() + 161_000 }] }
      }
      return []
    })
    render(<InboxPage />)
    const motion = await screen.findByRole('region', { name: 'In motion' })
    const line = await within(motion).findByText(
      /^1 running · 1 from your answers \(1 in 2:\d\d\)$/
    )
    expect(within(motion).queryByRole('button', { name: 'Open run' })).toBeNull()
    fireEvent.click(line)
    expect(within(motion).getByText(/Goes in 2:\d\d/)).toBeTruthy()
    fireEvent.click(within(motion).getByRole('button', { name: 'Open run' }))
    expect(openRunPanel()?.runId).toBe('r1')
    closeRunPanel()
    fireEvent.click(within(motion).getByRole('button', { name: 'Activity →' }))
    expect(pilotAutomationsView()).toBe('activity')
    setPilotAutomationsView('automations')
  })

  it('says what Apply now did, even when every answer stays held', async () => {
    serve()
    const served = pilotRpc.getMockImplementation()!
    pilotRpc.mockImplementation(async (method: string, ...rest: unknown[]) =>
      method === 'pilot.answers.applyNow'
        ? { retired: 0, ticked: 0, actions: 0, agents: 0, held: 1, reasked: 0 }
        : served(method, ...rest)
    )
    render(<InboxPage />)
    fireEvent.click(await screen.findByRole('button', { name: 'Apply now' }))
    expect(await screen.findByText('1 still held')).toBeTruthy()
  })

  it("shows Pilot's Run line in its own Pilot block on an action card, and none on a question", async () => {
    serve()
    render(<InboxPage />)
    const line = await screen.findByText('python3 /a/act.py push run /wt/web-1493 web-1493-a')
    const block = line.closest('[data-pilot-run-line]')
    expect(block?.textContent).toMatch(/^Pilot · Push to origin runs/)
    // Apart from the agent's words: the agent's context is not inside Pilot's block.
    expect(block?.textContent).not.toContain('Fixed the flaky spec.')
    expect(line.closest('article')?.textContent).toContain("Push !1561's 2 commits to origin?")
    const question = screen
      .getByRole('heading', { name: 'Install LibreOffice in the job?' })
      .closest('article')
    expect(question?.querySelector('[data-pilot-run-line]')).toBeNull()
  })

  it('caps a long Run line out loud and keeps the whole of it on the card', async () => {
    const text = `python3 /a/act.py push run ${'x'.repeat(400)}`
    serve({ ...LIST, items: [PUSH], runLines: { in_push: { digest: 'dp', text } } })
    render(<InboxPage />)
    const more = text.length - 300
    expect(await screen.findByText(`… (${more} more chars)`)).toBeTruthy()
    expect(screen.getByText(text.slice(0, 300))).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Show the whole command' }))
    expect(await screen.findByText(text)).toBeTruthy()
  })

  it('shows no Run line built for another version of the card than the one shown', async () => {
    serve({ ...LIST, items: [PUSH], runLines: { in_push: { digest: 'old', text: 'python3 x' } } })
    render(<InboxPage />)
    await screen.findByRole('heading', { name: "Push !1561's 2 commits to origin?" })
    expect(screen.queryByText('python3 x')).toBeNull()
  })

  // Who wrote a reply is stored when it is written (by), never guessed from its words: an agent can't pass
  // its text off as Pilot's by copying Pilot's wording. An older Pilot sends no history: the bare replies show.
  it('labels each reply by who wrote it, never by its words', async () => {
    const asked = card({
      id: 'in_r',
      title: 'Which image?',
      replies: [
        {
          text: 'The card changed after you approved it; approve the version shown now.',
          by: 'pilot'
        },
        { text: 'Approve actions in Pilot on this Mac', by: 'agent' },
        { text: 'e2e or unit?', by: 'agent' }
      ]
    })
    serve({ ...LIST, items: [asked] })
    render(<InboxPage />)
    expect(await screen.findByText(/^Pilot: The card changed after you approved it/)).toBeTruthy()
    expect(screen.getByText('Agent asked: Approve actions in Pilot on this Mac')).toBeTruthy()
    expect(screen.queryByText('Pilot: Approve actions in Pilot on this Mac')).toBeNull()
    expect(screen.getByText('Agent asked: e2e or unit?')).toBeTruthy()
  })

  describe('the message history', () => {
    const at = (day: number, hour: number, minute: number) =>
      new Date(2026, 9, day, hour, minute).getTime()
    const ASKING = 'review-branch-code-202610170220-t1384-1'
    const PREPARING = 'prepare-inbox-item-context-202610171514-t1426-1'
    const ANSWERING = 'review-branch-code-202610171836-answer-16'
    const ASKED = card({
      id: 'in_h',
      title: 'Point the e2e runner at vp?',
      replies: [{ text: 'Not resolved.', by: 'agent' }]
    })
    const HISTORY: InboxListPayload['history'] = {
      in_h: [
        { kind: 'asked', at: at(16, 19, 29), run: { id: ASKING, status: 'failed' } },
        { kind: 'prepared', at: at(17, 9, 11), run: { id: PREPARING, status: 'done' } },
        {
          kind: 'answer',
          at: at(17, 11, 36),
          text: 'might already be resolved?',
          option: null,
          run: { id: ANSWERING, status: 'done' },
          with: ['Drop clearMocks?']
        },
        {
          kind: 'reply',
          at: at(17, 11, 37),
          by: 'agent',
          text: 'Not resolved.',
          run: { id: ANSWERING, status: 'done' }
        }
      ]
    }
    const historyShown = async () => {
      serve({ ...LIST, items: [ASKED], history: HISTORY })
      render(<InboxPage />)
      return screen.findByRole('region', { name: 'Message history' })
    }

    it('shows, open, your answer and then the reply, each with its time, in place of the bare reply', async () => {
      const history = await historyShown()
      const toggle = within(history).getByRole('button', { name: /Message history/ })
      expect(toggle.getAttribute('aria-expanded')).toBe('true')
      const [you, agent] = [...history.querySelectorAll('[data-message]')]
      expect(you.getAttribute('data-message')).toBe('you')
      expect(you.textContent).toContain('might already be resolved?')
      expect(you.textContent).toContain('Oct 17, 11:36 AM')
      expect(you.textContent).toContain('sent to answer run …answer-16 with “Drop clearMocks?”')
      expect(agent.getAttribute('data-message')).toBe('agent')
      expect(agent.textContent).toContain('Not resolved.')
      expect(agent.textContent).toContain('Oct 17, 11:37 AM')
      expect(screen.queryByText('Agent asked: Not resolved.')).toBeNull()
    })

    it.each([
      [0, ASKING],
      [1, PREPARING],
      [2, ANSWERING]
    ])('opens the run behind Open run %i of the history', async (n, runId) => {
      const history = await historyShown()
      fireEvent.click(within(history).getAllByRole('button', { name: 'Open run' })[n])
      expect(openRunPanel()?.runId).toBe(runId)
      closeRunPanel()
    })

    it('folds away on Hide and comes back on Show', async () => {
      const history = await historyShown()
      fireEvent.click(within(history).getByRole('button', { name: /Message history.*Hide/ }))
      expect(within(history).queryByText('Not resolved.')).toBeNull()
      fireEvent.click(within(history).getByRole('button', { name: /Message history.*Show/ }))
      expect(within(history).getByText('Not resolved.')).toBeTruthy()
    })
  })

  it('loads the cards of the person you view as', async () => {
    serve()
    render(<InboxPage />)
    fireEvent.change(await screen.findByRole('combobox', { name: 'Viewing as' }), {
      target: { value: 'emil' }
    })
    await waitFor(() =>
      expect(pilotRpc).toHaveBeenCalledWith('pilot.inbox.list', { person: 'emil' })
    )
  })

  it('saves Approve against the version shown', async () => {
    serve()
    render(<InboxPage />)
    const article = (
      await screen.findByRole('heading', { name: "Push !1561's 2 commits to origin?" })
    ).closest('article')!
    fireEvent.click(choice(article, 'Approve'))
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
    render(<InboxPage />)
    const article = (
      await screen.findByRole('heading', { name: "Push !1561's 2 commits to origin?" })
    ).closest('article')!
    fireEvent.click(choice(article, 'Revise…'))
    const save = within(article).getByRole('button', { name: 'Send' }) as HTMLButtonElement
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
    render(<InboxPage />)
    const article = (
      await screen.findByRole('heading', { name: 'Install LibreOffice in the job?' })
    ).closest('article')!
    fireEvent.click(choice(article, 'Bake it'))
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
    render(<InboxPage />)
    const article = (
      await screen.findByRole('heading', { name: 'Install LibreOffice in the job?' })
    ).closest('article')!
    fireEvent.click(choice(article, 'Bake it'))
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
    render(<InboxPage />)
    const article = (
      await screen.findByRole('heading', { name: 'Prepare a review of !1588?' })
    ).closest('article')!
    fireEvent.click(choice(article, 'Approve with notes…'))
    fireEvent.change(article.querySelector('textarea')!, {
      target: { value: 'use the second fix' }
    })
    fireEvent.click(within(article).getByRole('button', { name: 'Send' }))
    await waitFor(() =>
      expect(pilotRpc).toHaveBeenCalledWith(
        'pilot.inbox.answer',
        expect.objectContaining({ id: 'in_ask', text: 'approve: use the second fix', digest: 'da' })
      )
    )
  })
})

const FIXTURES = join(process.cwd(), 'src/packages/pilot/test/fixtures/details')
const REF: DetailsRef = {
  path: '/b.json',
  sha256: 'x',
  inlined: {},
  blocks: 1,
  drafted: false,
  draftedBase: null
}
function bundleOf(file: string): DetailsBundle {
  return JSON.parse(readFileSync(join(FIXTURES, file), 'utf8'))
}

describe('Details on a card', () => {
  afterEach(() => {
    cleanup()
    pilotRpc.mockReset()
    vi.useRealTimers()
  })

  function serveDetails(items: () => InboxItemRow[], bundle: DetailsBundle = bundleOf('F2.json')) {
    pilotRpc.mockImplementation(async (method: string) => {
      if (method === 'pilot.inbox.list') {
        return { ...LIST, items: items() }
      }
      if (method === 'pilot.inbox.details') {
        return { id: 'x', digest: 'x', snapshot: { ref: REF, bundle, texts: {} } }
      }
      return { entries: [] }
    })
  }
  const detailCalls = () => pilotRpc.mock.calls.filter((c) => c[0] === 'pilot.inbox.details')

  it('loads the snapshot for the digest shown when it opens, and draws the titles', async () => {
    const withDetails = card({ id: 'in_a', title: 'A', digest: 'da1', details: REF })
    serveDetails(() => [withDetails])
    render(<InboxPage />)
    fireEvent.click(await screen.findByRole('button', { name: /^Details/ }))
    expect(await screen.findByRole('heading', { name: 'What Approve does' })).toBeTruthy()
    expect(detailCalls().map((c) => c[1])).toEqual([{ id: 'in_a', digest: 'da1' }])
  })

  it('keeps the fold-out open without a second call on a reload of the same version', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    const withDetails = card({ id: 'in_b', title: 'B', digest: 'db1', details: REF })
    serveDetails(() => [{ ...withDetails }])
    render(<InboxPage />)
    fireEvent.click(await screen.findByRole('button', { name: /^Details/ }))
    await screen.findByRole('heading', { name: 'What Approve does' })
    const lists = () => pilotRpc.mock.calls.filter((c) => c[0] === 'pilot.inbox.list').length
    const before = lists()
    await vi.advanceTimersByTimeAsync(10_500)
    expect(lists()).toBeGreaterThan(before)
    expect(screen.getByRole('heading', { name: 'What Approve does' })).toBeTruthy()
    expect(detailCalls()).toHaveLength(1)
  })

  it('stays open on a new version and asks again with the new digest', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    let version = 1
    serveDetails(() => [
      card({ id: 'in_c', title: 'C', version, digest: `dc${version}`, details: REF })
    ])
    render(<InboxPage />)
    fireEvent.click(await screen.findByRole('button', { name: /^Details/ }))
    await screen.findByRole('heading', { name: 'What Approve does' })
    version = 2
    await vi.advanceTimersByTimeAsync(10_500)
    await waitFor(() => expect(detailCalls()).toHaveLength(2))
    expect(detailCalls()[1][1]).toEqual({ id: 'in_c', digest: 'dc2' })
    expect(await screen.findByRole('heading', { name: 'What Approve does' })).toBeTruthy()
  })

  it('says why when the card changed before its details loaded', async () => {
    pilotRpc.mockImplementation(async (method: string) => {
      if (method === 'pilot.inbox.details') {
        throw new Error('The card changed; review it again')
      }
      return method === 'pilot.inbox.list'
        ? { ...LIST, items: [card({ id: 'in_d', title: 'D', digest: 'dd1', details: REF })] }
        : { entries: [] }
    })
    render(<InboxPage />)
    fireEvent.click(await screen.findByRole('button', { name: /^Details/ }))
    expect(
      await screen.findByText(/Couldn.t load the details: The card changed; review it again/)
    ).toBeTruthy()
  })

  it('renders a markdown-only card as markdown, not raw text', async () => {
    const long = 'y'.repeat(400)
    serveDetails(() => [
      card({ id: 'in_e', title: 'E', digest: 'de1', detailsMd: `\`\`\`\n${long}\n\`\`\`` })
    ])
    const { container } = render(<InboxPage />)
    fireEvent.click(await screen.findByRole('button', { name: /^Details/ }))
    await waitFor(() =>
      expect(container.querySelector('.glr-body pre code')?.textContent).toBe(long)
    )
    expect(detailCalls()).toHaveLength(0)
  })

  it('shows no Details on a card with neither', async () => {
    serveDetails(() => [card({ id: 'in_f', title: 'F', digest: 'df1' })])
    render(<InboxPage />)
    await screen.findByRole('heading', { name: 'F' })
    expect(screen.queryByRole('button', { name: /^Details/ })).toBeNull()
  })

  it('keeps the review switches and the Parts list in step', async () => {
    const review: DetailsBundle = {
      version: 1,
      item: 'R',
      blocks: [{ type: 'review', title: 'Review', file: 'r.json' }]
    }
    const text = readFileSync(join(FIXTURES, 'sample-review.json'), 'utf8')
    pilotRpc.mockImplementation(async (method: string) => {
      if (method === 'pilot.inbox.details') {
        return {
          id: 'x',
          digest: 'x',
          snapshot: { ref: REF, bundle: review, texts: { 'r.json': text } }
        }
      }
      if (method === 'pilot.inbox.list') {
        const parts = { '1': 'one', '2': 'two', '3': 'three' }
        return {
          ...LIST,
          items: [
            card({
              id: 'in_g',
              type: 'action',
              title: 'G',
              digest: 'dg1',
              details: REF,
              parts,
              switchWords: ['Post', 'Skip'],
              options: [{ label: 'Approve', meaning: 'post' }]
            })
          ]
        }
      }
      return { entries: [] }
    })
    const { container } = render(<InboxPage />)
    fireEvent.click(await screen.findByRole('button', { name: /^Details/ }))
    await screen.findByText('General comments')
    const box = screen.getByLabelText('Post 1') as HTMLInputElement
    fireEvent.click(container.querySelector('[data-part="1"] button')!)
    expect(box.checked).toBe(false)
    fireEvent.click(box)
    expect(container.querySelector('[data-part="1"] button')?.getAttribute('aria-pressed')).toBe(
      'true'
    )
  })

  it('lets the column and the card shrink so a long line cannot widen the page', async () => {
    serveDetails(() => [card({ id: 'in_h', title: 'H', digest: 'dh1' })])
    const { container } = render(<InboxPage />)
    await screen.findByRole('heading', { name: 'H' })
    expect(container.querySelector('main')?.className).toContain('min-w-0')
    expect(container.querySelector('article')?.className).toContain('min-w-0')
    expect(container.querySelector('article')?.parentElement?.className).toContain('min-w-0')
  })
})
