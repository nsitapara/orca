import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { parseAutomationYaml } from '../../shared/definition/parse'
import type { InboxAddParams } from '../../shared/inbox-types'
import { parsePeopleYaml } from '../../shared/people'
import type { ActionEntry } from '../actions/types'
import { addReady } from '../inbox/__fixtures__/prepared'
import { resolveInboxItem, type InboxDeps } from '../inbox/inbox-service'
import type { MrBlock } from '../inbox/mr-state'
import { PilotStore } from '../store/store'
import { UnrecordedLaunchError } from '../scheduler/tick-runner'
import { FREE_HOLDS } from './__fixtures__/holds'
import { currentAnswer } from './answer-run'
import {
  AnswerDispatcher,
  answerRunEnded,
  ANSWER_RUN_STOPPED,
  MAX_ATTEMPTS,
  type DispatcherDeps
} from './dispatcher'
import type { HoldDeps } from './holds'
import { ANSWER_LOCKED, saveAnswer, SETTLE_MS } from './save'

const def = parseAutomationYaml(
  'name: Fix CI\nrepo: r\nschedule: manual\nitems: { kind: merge_request }\nsteps: [ { agent: claude, skill: fix-gitlab-ci, prompt: x } ]\npowers: [push]\ninbox: nish\n',
  '/a/ci.yaml'
)
const people = parsePeopleYaml('people:\n  - { id: nish, name: Nish }\n')
if (!def.ok || !people.ok) {
  throw new Error('setup')
}
const QUESTION: InboxAddParams = {
  runId: 'run-1',
  type: 'question',
  title: 'Which image?',
  options: ['e2e', 'unit']
}
const ACTION: InboxAddParams = {
  ...QUESTION,
  type: 'action',
  title: 'Push?',
  action: 'push',
  actionArgs: { argv: ['a'] }
}

type Over = {
  holds?: Partial<HoldDeps>
  block?: MrBlock | null
  open?: () => Promise<unknown>
}

function setup(over: Over = {}) {
  const store = PilotStore.open(join(mkdtempSync(join(tmpdir(), 'pilot-dispatch-')), 'db.sqlite'))
  store.runs.create({
    id: 'run-1',
    automationId: 'ci',
    tickId: null,
    itemKey: 'mr:1561',
    itemLabel: '!1561',
    worktreePath: '/wt',
    startedAt: 1
  })
  store.runs.createStep({
    runId: 'run-1',
    idx: 0,
    name: 'fix',
    agent: 'claude',
    skill: 'fix-gitlab-ci',
    startedAt: 1
  })
  store.runs.updateStep('run-1', 0, {
    status: 'done',
    sessionId: '00000000-0000-4000-8000-000000000001'
  })
  let clock = 1_000_000
  let n = 0
  const inbox: InboxDeps = {
    store,
    now: () => clock,
    definitions: () => [def.ok ? def.definition : (null as never)],
    people: () => (people.ok ? people.directory : (null as never)),
    newId: () => `in_${String(++n).padStart(16, '0')}`
  }
  const push = {
    name: 'push',
    power: 'push',
    label: 'x',
    usage: 'x',
    checkArgs: () => null,
    describe: async () => 'x',
    run: vi.fn().mockResolvedValue({
      outcome: 'done',
      detail: 'pushed',
      link: null,
      log: null,
      onYou: false
    })
  } as ActionEntry
  const catalog = { entries: () => [push], get: (name: string) => (name === 'push' ? push : null) }
  const open = vi.fn(
    over.open ??
      (async () => ({
        terminalHandle: 'term-2',
        paneKey: 'p',
        sessionId: '00000000-0000-4000-8000-000000000002'
      }))
  )
  const holds = { ...FREE_HOLDS, ...over.holds }
  const deps: DispatcherDeps = {
    inbox,
    attempt: { store, now: () => clock, catalog, definitions: inbox.definitions, inbox },
    // An open MR unless a test says otherwise.
    retirer: {
      pass: async () => 0,
      blockFor: () => ('block' in over ? (over.block ?? null) : { finished: null })
    },
    holds: () => holds,
    agents: {
      store,
      now: () => clock,
      probe: {
        terminalState: async () => 'gone',
        transcript: async () => ({ size: 1, mtimeMs: clock })
      },
      quota: async () => ({ weekly: 1, session: 1 }),
      open: open as never,
      send: vi.fn(),
      mainCheckout: async () => '/main',
      current: (item) => currentAnswer(store, item)
    },
    log: () => {}
  }
  // Approvals come from the desktop app; a paired device answers questions.
  const answer = (params: InboxAddParams, text: string) => {
    const { id } = addReady(inbox, params)
    const callerKind = params.type === 'action' ? 'desktop' : 'paired-device'
    saveAnswer(
      inbox,
      { id: id!, text, digest: store.inbox.get(id!)!.digest },
      { callerKind, catalog }
    )
    return id!
  }
  return {
    store,
    inbox,
    deps,
    open,
    push,
    holds,
    dispatcher: new AnswerDispatcher(deps),
    answer,
    settle: () => (clock += SETTLE_MS)
  }
}

describe('AnswerDispatcher', () => {
  it('waits out the 180 s settle, then applies the answer', async () => {
    const { store, dispatcher, answer, settle } = setup()
    const id = answer({ ...QUESTION, type: 'default' }, 'keep')
    await dispatcher.pass()
    expect(store.inbox.get(id)?.status).toBe('answered')
    settle()
    expect(await dispatcher.pass()).toMatchObject({ ticked: 1 })
    expect(store.inbox.get(id)).toMatchObject({ status: 'done', outcome: 'kept' })
  })

  it.each<[string, Partial<HoldDeps>, string, string]>([
    ['the worktree is gone', { exists: () => false }, 'no_worktree', 'no worktree for this branch'],
    [
      'a run is working there',
      { runsIn: () => [{ id: 'review-9' }] },
      'worktree_busy',
      'run review-9 is working there'
    ],
    [
      'work is in flight',
      { inFlight: async () => 'uncommitted changes' },
      'in_flight',
      'uncommitted changes'
    ],
    [
      'someone is typing',
      { activity: async () => ({ typing: true, reason: 'someone is typing in zsh' }) },
      'typing',
      'someone is typing in zsh'
    ]
  ])(
    'holds what would touch the worktree while %s, and still closes a card-only answer',
    async (_name, holds, holdReason, holdDetail) => {
      const { store, push, dispatcher, answer, settle } = setup({ holds })
      const action = answer(ACTION, 'approve')
      const kept = answer({ ...QUESTION, type: 'default' }, 'keep')
      settle()
      expect(await dispatcher.pass()).toMatchObject({ held: 1, actions: 0, ticked: 1 })
      expect(push.run).not.toHaveBeenCalled()
      expect(store.queue.forInboxItem(action)).toMatchObject([
        { state: 'held', holdReason, holdDetail }
      ])
      expect(store.inbox.get(kept)).toMatchObject({ status: 'done', outcome: 'kept' })
    }
  )

  it.each<[string, MrBlock | null, string]>([
    [
      "GitLab can't say whether the MR is finished",
      { unknown: 'MR state unknown: glab: 502' },
      'MR state unknown: glab: 502'
    ],
    ["the MR's state wasn't read", null, "MR state unknown: it hasn't been read yet"]
  ])('holds while %s', async (_name, block, holdDetail) => {
    const { store, dispatcher, answer, settle } = setup({ block })
    const id = answer(QUESTION, 'e2e')
    settle()
    await dispatcher.pass()
    expect(store.queue.forInboxItem(id)).toMatchObject([
      { state: 'held', holdReason: 'mr_unknown', holdDetail }
    ])
  })

  it('runs an approved action and sends every other answer of the worktree to one session', async () => {
    const { store, open, push, dispatcher, answer, settle } = setup()
    const action = answer(ACTION, 'approve')
    const first = answer(QUESTION, 'e2e')
    const second = answer({ ...QUESTION, title: 'Retry once?' }, 'yes, once')
    settle()
    expect(await dispatcher.pass()).toMatchObject({ actions: 1, agents: 1 })
    expect(push.run).toHaveBeenCalledTimes(1)
    expect(store.inbox.get(action)).toMatchObject({ status: 'done', outcome: 'done: pushed' })
    expect(open).toHaveBeenCalledTimes(1)
    const prompt = (open.mock.calls[0] as unknown as [{ prompt: string }])[0].prompt
    expect(prompt).toContain(`[${first}] "Which image?" → "e2e"`)
    expect(prompt).toContain(`[${second}] "Retry once?" → "yes, once"`)
    expect(store.queue.forInboxItem(first)).toMatchObject([
      {
        state: 'dispatched',
        route: 'fork',
        targetSessionId: '00000000-0000-4000-8000-000000000002'
      }
    ])
  })

  it('re-asks an approval a paired device gave, running nothing', async () => {
    const { store, push, inbox, dispatcher, settle } = setup()
    const { id } = addReady(inbox, ACTION)
    // Saved before the desktop-only rule, or imported: the stored caller isn't the desktop.
    store.inbox.update(
      id!,
      {
        status: 'answered',
        answer: {
          option: null,
          text: 'approve',
          digest: store.inbox.get(id!)!.digest,
          via: 'device',
          callerKind: 'paired-device'
        }
      },
      1
    )
    store.queue.enqueue(id!, 0, 0)
    settle()
    expect(await dispatcher.pass()).toMatchObject({ reasked: 1, actions: 0 })
    expect(push.run).not.toHaveBeenCalled()
    expect(store.inbox.get(id!)).toMatchObject({ status: 'open', answer: null })
  })

  it('acts only on what is still answered: a card ticked, or an answer changed, while the pass was busy', async () => {
    const s = setup()
    const action = s.answer(ACTION, 'approve')
    const question = s.answer(QUESTION, 'e2e')
    s.settle()
    // While the action runs, the agent ticks the question itself.
    vi.mocked(s.push.run).mockImplementationOnce(async () => {
      resolveInboxItem(s.inbox, question, 'done: answered by hand')
      return { outcome: 'done', detail: 'pushed', link: null, log: null, onYou: false }
    })
    expect(await s.dispatcher.pass()).toMatchObject({ actions: 1, agents: 0 })
    expect(s.store.inbox.get(action)).toMatchObject({ status: 'done', outcome: 'done: pushed' })
    expect(s.open).not.toHaveBeenCalled()
    expect(s.store.inbox.get(question)).toMatchObject({ outcome: 'done: answered by hand' })
    // An approval changed to Skip while the worktree was being checked is not run.
    const again = s.answer({ ...ACTION, title: 'Push again?' }, 'approve')
    s.settle()
    s.holds.inFlight = async () => {
      // The page refuses this once the row is ready (ANSWER_LOCKED); the dispatcher still checks what it reads.
      const now = s.store.inbox.get(again)!
      s.store.inbox.update(again, { answer: { ...now.answer!, text: 'skip' } }, 5_000)
      return null
    }
    await s.dispatcher.pass()
    expect(s.push.run).toHaveBeenCalledTimes(1)
    expect(s.store.inbox.get(again)?.answer?.text).toBe('skip')
  })

  // Fix round 1 (req 9): dispatchToAgent awaits the tab, the quota and the checkout before the prompt.
  it("leaves a card ticked during the quota read out of the agent's prompt", async () => {
    const s = setup()
    const first = s.answer(QUESTION, 'e2e')
    const second = s.answer({ ...QUESTION, title: 'Retry once?' }, 'yes')
    s.settle()
    s.deps.agents.quota = async () => {
      resolveInboxItem(s.inbox, second, 'done: by hand')
      return { weekly: 1, session: 1 }
    }
    expect(await s.dispatcher.pass()).toMatchObject({ agents: 1 })
    const prompt = (s.open.mock.calls[0] as unknown as [{ prompt: string }])[0].prompt
    expect(prompt).toContain(`[${first}]`)
    expect(prompt).not.toContain(`[${second}]`)
  })

  it('hands the cards back when their answers went to an agent Pilot cannot follow', async () => {
    const { store, open, dispatcher, answer, settle } = setup({
      open: async () => {
        throw new UnrecordedLaunchError('term-9', 'the runtime returned no pane to watch')
      }
    })
    const id = answer(QUESTION, 'e2e')
    settle()
    expect(await dispatcher.pass()).toMatchObject({ reasked: 1, agents: 0 })
    expect(store.inbox.get(id)).toMatchObject({ status: 'open', answer: null })
    expect(store.inbox.get(id)?.replies[0]).toMatchObject({
      text: expect.stringContaining('terminal term-9'),
      by: 'pilot'
    })
    await dispatcher.pass()
    expect(open).toHaveBeenCalledTimes(1)
  })

  it(`retries a failed dispatch, then marks it failed after ${MAX_ATTEMPTS} tries`, async () => {
    const { store, dispatcher, answer, settle } = setup({
      open: async () => {
        throw new Error('worktree is gone')
      }
    })
    const id = answer(QUESTION, 'e2e')
    settle()
    for (let i = 0; i < MAX_ATTEMPTS; i += 1) {
      await dispatcher.pass()
    }
    expect(store.queue.forInboxItem(id)).toMatchObject([
      {
        state: 'failed',
        attempts: MAX_ATTEMPTS,
        holdReason: 'retry',
        holdDetail: 'worktree is gone'
      }
    ])
  })

  it('lets a second caller join the pass already running', async () => {
    const { dispatcher } = setup()
    const a = dispatcher.pass()
    expect(dispatcher.pass()).toBe(a)
    await a
  })
})

describe('AnswerDispatcher.applyNow (apply.py now)', () => {
  it('runs one more pass after a pass already running, so hurried answers go now', async () => {
    const s = setup()
    const first = s.answer(QUESTION, 'e2e')
    s.settle()
    let reached = false
    let release = () => {}
    s.holds.inFlight = () => {
      if (reached) {
        return Promise.resolve(null)
      }
      reached = true
      return new Promise((resolve) => (release = () => resolve(null)))
    }
    const running = s.dispatcher.pass()
    await vi.waitFor(() => expect(reached).toBe(true))
    const second = s.answer({ ...QUESTION, title: 'Retry once?' }, 'yes')
    const hurried = s.dispatcher.applyNow({ ids: [second], approver: false })
    expect(s.dispatcher.applyNow({ approver: false })).toBe(hurried)
    release()
    expect(await running).toMatchObject({ agents: 1 })
    expect(await hurried).toMatchObject({ agents: 1 })
    const prompts = s.open.mock.calls.map((c) => (c as unknown as [{ prompt: string }])[0].prompt)
    expect(prompts[0]).toContain(`[${first}]`)
    expect(prompts[1]).toContain(`[${second}]`)
  })

  it('skips the settle of the answers it names, then runs a pass', async () => {
    const { store, open, dispatcher, answer } = setup()
    const first = answer(QUESTION, 'e2e')
    const second = answer({ ...QUESTION, title: 'Retry once?' }, 'yes')
    expect(await dispatcher.applyNow({ ids: [first], approver: false })).toMatchObject({
      agents: 1
    })
    expect(open).toHaveBeenCalledTimes(1)
    expect(store.queue.forInboxItem(first)).toMatchObject([{ state: 'dispatched' }])
    expect(store.queue.forInboxItem(second)).toMatchObject([{ state: 'not_ready' }])
  })

  it("hurries an approval past its settle only for Pilot's desktop app", async () => {
    const { store, push, dispatcher, answer } = setup()
    const action = answer(ACTION, 'approve')
    await dispatcher.applyNow({ approver: false })
    expect(push.run).not.toHaveBeenCalled()
    expect(store.queue.forInboxItem(action)).toMatchObject([{ state: 'not_ready' }])
    expect(await dispatcher.applyNow({ approver: true })).toMatchObject({ actions: 1 })
    expect(push.run).toHaveBeenCalledTimes(1)
  })
})

describe('answerRunEnded (G6)', () => {
  // An answer run that carried one dispatched answer, ended with these outputs and this status.
  function ended(
    outputs: Record<string, string>,
    status: 'done' | 'needs_you' | 'failed' | 'timed_out' | 'cancelled' = 'done'
  ) {
    const s = setup()
    const id = s.answer(QUESTION, 'e2e')
    s.store.runs.create({
      id: 'ans-1',
      automationId: 'ci',
      tickId: null,
      itemKey: 'mr:1561',
      itemLabel: '!1561',
      worktreePath: '/wt',
      startedAt: 1,
      trigger: 'answer',
      parentRunId: 'run-1'
    })
    s.store.runs.createStep({
      runId: 'ans-1',
      idx: 0,
      name: 'answers',
      agent: 'claude',
      skill: 'fix-gitlab-ci',
      startedAt: 1,
      kind: 'agent'
    })
    s.store.runs.updateStep('ans-1', 0, { status: 'done', outputs })
    s.store.runs.update('ans-1', { status, finishedAt: 2 })
    const row = s.store.queue.forInboxItem(id)[0]
    // Sent once the answer settled.
    s.store.queue.update(row.id, { state: 'dispatched', dispatchedRunId: 'ans-1' }, s.settle())
    return { ...s, id, row, end: () => answerRunEnded(s.store, s.store.runs.get('ans-1')!) }
  }

  // Nish revises the card after its answer went to ans-1: the revision settles on its own, so ans-1's
  // outcome never closes the card (losing the revision) nor hands it back.
  function revise(s: ReturnType<typeof ended>, text: string): void {
    s.settle()
    saveAnswer(
      s.inbox,
      { id: s.id, text, digest: s.store.inbox.get(s.id)!.digest },
      { callerKind: 'paired-device', catalog: { get: () => null } }
    )
  }

  it.each<[string, Record<string, string>, 'done' | 'cancelled' | 'failed']>([
    ['closes it', { outcome: 'set the e2e image', item_status: 'done' }, 'done'],
    ['reopens it', { item_status: 'open', reply: 'Which?' }, 'done'],
    ['was stopped', {}, 'cancelled'],
    ['failed', {}, 'failed']
  ])(
    'revise then approve after dispatch: the old run that %s leaves the revised card waiting',
    (_name, outputs, status) => {
      const s = ended(outputs, status)
      revise(s, 'unit')
      s.end()
      expect(s.store.inbox.get(s.id)).toMatchObject({
        status: 'answered',
        answer: expect.objectContaining({ text: 'unit' }),
        replies: []
      })
      expect(s.store.queue.forInboxItem(s.id)).toMatchObject([
        { id: s.row.id, state: 'dispatched', attempts: 0 },
        { state: 'not_ready' }
      ])
    }
  )

  it('leaves a revised card alone once the revision itself was sent to another run', () => {
    const s = ended({ outcome: 'set the e2e image', item_status: 'done' })
    revise(s, 'unit')
    const next = s.store.queue.forInboxItem(s.id)[1]
    s.store.queue.update(next.id, { state: 'dispatched', dispatchedRunId: 'ans-2' }, s.settle())
    s.end()
    expect(s.store.inbox.get(s.id)).toMatchObject({
      status: 'answered',
      answer: expect.objectContaining({ text: 'unit' })
    })
  })

  it.each<[string, Record<string, string>, object]>([
    [
      'reports done',
      { outcome: 'set the e2e image', item_status: 'done' },
      { status: 'done', outcome: 'set the e2e image' }
    ],
    ['reports nothing', {}, { status: 'done' }],
    [
      'finds the card stale',
      { outcome: 'head moved', item_status: 'stale' },
      { status: 'stale', outcome: 'head moved' }
    ],
    [
      'leaves it open with a question',
      { item_status: 'open', reply: 'Which image:\n- [ ] e2e or unit?' },
      {
        status: 'open',
        answer: null,
        answeredAt: null,
        replies: [{ text: 'Which image: - [ ] e2e or unit?', by: 'agent' }]
      }
    ]
  ])('a run that %s', (_name, outputs, expected) => {
    const { store, id, end } = ended(outputs)
    end()
    expect(store.inbox.get(id)).toMatchObject(expected)
  })

  it('reopens a card without a reply, logging no empty reply', () => {
    const { store, id, end } = ended({ item_status: 'open' })
    end()
    expect(store.inbox.get(id)).toMatchObject({ status: 'open', answer: null, replies: [] })
    expect(store.events.list({ kinds: ['item_replied'] })).toEqual([])
  })

  it('hands the card back, never restarting it, when Nish stopped the answer run', () => {
    const { store, id, row, end } = ended({}, 'cancelled')
    end()
    expect(store.inbox.get(id)).toMatchObject({
      status: 'open',
      answer: null,
      replies: [{ text: ANSWER_RUN_STOPPED, by: 'pilot' }]
    })
    expect(store.queue.get(row.id)).toMatchObject({ state: 'dispatched', attempts: 0 })
  })

  it('closes the card of a run that ended waiting on new cards it filed', () => {
    const { store, id, end } = ended({ outcome: 'asked again' }, 'needs_you')
    end()
    expect(store.inbox.get(id)).toMatchObject({ status: 'done', outcome: 'asked again' })
  })

  it('leaves a card the agent already ticked alone', () => {
    const { store, id, end } = ended({ outcome: 'later words', item_status: 'done' })
    store.inbox.update(id, { status: 'done', outcome: 'done: pushed' }, 5)
    end()
    expect(store.inbox.get(id)).toMatchObject({ status: 'done', outcome: 'done: pushed' })
  })

  it.each(['failed', 'timed_out'] as const)(
    'queues the answer for another try when the run %s',
    (status) => {
      const { store, id, row, end } = ended({}, status)
      end()
      expect(store.inbox.get(id)?.status).toBe('answered')
      expect(store.queue.get(row.id)).toMatchObject({
        state: 'held',
        holdReason: 'retry',
        attempts: 1
      })
    }
  )
})

describe('the answer lock during a pass', () => {
  const DESKTOP = (s: ReturnType<typeof setup>) => ({
    callerKind: 'desktop' as const,
    catalog: { get: () => s.push }
  })

  it('locks a held row the moment a pass picks it up, so nothing can change it while it is applied', async () => {
    const s = setup({
      holds: { activity: async () => ({ typing: true, reason: 'someone is typing' }) }
    })
    const id = s.answer(ACTION, 'approve')
    s.settle()
    await s.dispatcher.pass()
    expect(s.store.queue.forInboxItem(id)[0]).toMatchObject({ state: 'held' })
    // Typing stops; the next pass takes the held row up and applies it.
    s.holds.activity = async () => null
    const digest = s.store.inbox.get(id)!.digest
    const during: unknown[] = []
    vi.mocked(s.push.run).mockImplementationOnce(async () => {
      during.push(s.store.queue.forInboxItem(id)[0].state)
      for (const params of [
        { id, text: '', digest },
        { id, text: 'skip', digest }
      ]) {
        try {
          saveAnswer(s.inbox, params, DESKTOP(s))
          during.push('changed')
        } catch (error) {
          during.push((error as Error).message)
        }
      }
      return { outcome: 'done', detail: 'pushed', link: null, log: null, onYou: false }
    })
    await s.dispatcher.pass()
    expect(during).toEqual(['ready', ANSWER_LOCKED, ANSWER_LOCKED])
    expect(s.push.run).toHaveBeenCalledTimes(1)
    expect(s.store.inbox.get(id)).toMatchObject({ status: 'done', outcome: 'done: pushed' })
  })

  it('puts a row back to held, unlocked, when the hold applies again', async () => {
    const s = setup({
      holds: { activity: async () => ({ typing: true, reason: 'someone is typing' }) }
    })
    const id = s.answer(ACTION, 'approve')
    s.settle()
    await s.dispatcher.pass()
    await s.dispatcher.pass()
    expect(s.store.queue.forInboxItem(id)[0]).toMatchObject({ state: 'held', holdReason: 'typing' })
    const digest = s.store.inbox.get(id)!.digest
    expect(saveAnswer(s.inbox, { id, text: '', digest }, DESKTOP(s))).toMatchObject({
      status: 'open'
    })
  })

  it('counts a try when a whole group throws, so a repeating throw ends failed and unlocked', async () => {
    const s = setup({
      holds: {
        exists: () => {
          throw new Error('boom')
        }
      }
    })
    const id = s.answer(ACTION, 'approve')
    s.settle()
    for (let i = 1; i <= MAX_ATTEMPTS; i++) {
      await s.dispatcher.pass()
      const row = s.store.queue.forInboxItem(id)[0]
      expect(row).toMatchObject({ attempts: i, state: i < MAX_ATTEMPTS ? 'held' : 'failed' })
    }
    expect(s.store.queue.forInboxItem(id)[0].holdDetail).toContain('boom')
  })
})

describe('the lock is per group', () => {
  it('locks a group when it starts, not every due row at the start of the pass', async () => {
    const s = setup()
    s.store.runs.create({
      id: 'run-2',
      automationId: 'ci',
      tickId: null,
      itemKey: 'mr:1562',
      itemLabel: '!1562',
      worktreePath: '/wt2',
      startedAt: 1
    })
    const first = s.answer(ACTION, 'approve')
    const second = s.answer({ ...ACTION, runId: 'run-2', title: 'Push the other?' }, 'approve')
    s.settle()
    const seen: Record<string, string> = {}
    vi.mocked(s.push.run).mockImplementationOnce(async () => {
      seen.first = s.store.queue.forInboxItem(first)[0].state
      seen.second = s.store.queue.forInboxItem(second)[0].state
      return { outcome: 'done', detail: 'pushed', link: null, log: null, onYou: false }
    })
    await s.dispatcher.pass()
    expect(seen).toEqual({ first: 'ready', second: 'not_ready' })
    expect(s.push.run).toHaveBeenCalledTimes(2)
  })

  it('never shows a row that re-holds as ready', async () => {
    const states: string[] = []
    const s = setup({
      holds: {
        activity: async () => {
          states.push(
            s.store.queue
              .list(['not_ready', 'ready', 'held'])
              .map((r) => r.state)
              .join()
          )
          return { typing: true, reason: 'someone is typing' }
        }
      }
    })
    s.answer(ACTION, 'approve')
    s.settle()
    await s.dispatcher.pass()
    await s.dispatcher.pass()
    expect(states).toEqual(['not_ready', 'held'])
  })
})
