import { describe, expect, it, vi } from 'vitest'
import {
  listBusyTerminals,
  runtimeBusyReads,
  tabBusy,
  worktreeBusy,
  type BusyReads,
  type BusyRuntime,
  type BusyTerminal,
  type TabReads
} from './worktree-busy'

const TAB: BusyTerminal = {
  handle: 'term_a',
  title: '✳ Fix',
  connected: true,
  agentIdentity: 'claude',
  worktreePath: '/wt/x',
  tabId: 't1',
  leafId: 'l1'
}

describe('worktreeBusy (gate.worktree_busy)', () => {
  it.each([
    ['idle and finished', TAB, '', 'done', false, null],
    ["finished per Orca's hooks, though the tui-idle probe times out", TAB, '', 'done', true, null],
    [
      'typing',
      TAB,
      'push it',
      'done',
      false,
      { typing: true, reason: 'someone is typing in ✳ Fix' }
    ],
    [
      'working on a background command, idle screen',
      TAB,
      '',
      'working',
      false,
      { typing: false, reason: '✳ Fix is working' }
    ],
    [
      'asking for input',
      TAB,
      '',
      'blocked',
      false,
      { typing: false, reason: '✳ Fix is asking for input' }
    ],
    ['waiting', TAB, '', 'waiting', false, { typing: false, reason: '✳ Fix is asking for input' }],
    [
      'mid-turn on screen, no state from Orca',
      TAB,
      '',
      null,
      true,
      { typing: false, reason: '✳ Fix is working' }
    ],
    ["another worktree's tab", { ...TAB, worktreePath: '/wt/y' }, 'x', 'working', true, null],
    [
      'a path written with a trailing slash and dot segment',
      { ...TAB, worktreePath: '/wt/./x/' },
      'push it',
      'done',
      false,
      { typing: true, reason: 'someone is typing in ✳ Fix' }
    ],
    ['a shell tab', { ...TAB, agentIdentity: null }, 'x', 'working', true, null],
    ['a closed tab', { ...TAB, connected: false }, 'x', 'working', true, null],
    [
      'a tab without a title is named by its handle',
      { ...TAB, title: null },
      'x',
      'done',
      false,
      { typing: true, reason: 'someone is typing in term_a' }
    ]
  ] as [
    string,
    BusyTerminal,
    string,
    string | null,
    boolean,
    { typing: boolean; reason: string } | null
  ][])('%s', async (_name, terminal, typed, state, midTurn, want) => {
    const reads: BusyReads = {
      draft: async () => typed,
      agentStates: async () => new Map(state ? [['t1:l1', state]] : []),
      tabBusy: async () => midTurn
    }
    expect(await worktreeBusy('/wt/x', [terminal], reads)).toEqual(want)
  })

  it('unreadable agent states count as busy', async () => {
    const reads: BusyReads = {
      draft: async () => '',
      agentStates: async () => {
        throw new Error('orca worktree ps: not running')
      },
      tabBusy: async () => false
    }
    expect(await worktreeBusy('/wt/x', [TAB], reads)).toEqual({
      typing: false,
      reason: '✳ Fix could not be read'
    })
  })
})

describe('worktreeBusy on an ended run’s tab', () => {
  const reads = (state: string): BusyReads => ({
    draft: async () => 'greyed suggestion',
    agentStates: async () => new Map([['t1:l1', state]]),
    tabBusy: async () => false
  })
  const ended = () => true

  it('an ended run’s tab with a draft and an idle agent isn’t busy', async () => {
    expect(await worktreeBusy('/wt/x', [TAB], reads('done'), ended)).toBeNull()
  })

  it('an ended run’s tab whose agent is working is busy', async () => {
    expect(await worktreeBusy('/wt/x', [TAB], reads('working'), ended)).toEqual({
      typing: false,
      reason: '✳ Fix is working'
    })
  })

  it('a person’s tab with a draft is still typing', async () => {
    expect(await worktreeBusy('/wt/x', [TAB], reads('done'), () => false)).toEqual({
      typing: true,
      reason: 'someone is typing in ✳ Fix'
    })
  })
})

describe('tabBusy (gate.tab_busy)', () => {
  const fail = async (): Promise<never> => {
    throw new Error('timeout')
  }
  it.each([
    ['Orca says the TUI is idle', { waitIdle: async () => true }, false],
    ['Orca says it is not idle', { waitIdle: async () => false }, true],
    ['the wait fails on a live pane', { waitIdle: fail, orphaned: async () => false }, true],
    [
      "an orphaned tab showing Claude's spinner",
      {
        waitIdle: fail,
        orphaned: async () => true,
        screen: async () => ['✽ Symbioting… (7m 39s · esc']
      },
      true
    ],
    [
      "an orphaned tab showing Codex's footer",
      { waitIdle: fail, orphaned: async () => true, screen: async () => ['  esc to interrupt'] },
      true
    ],
    [
      'an orphaned tab at a quiet prompt',
      { waitIdle: fail, orphaned: async () => true, screen: async () => ['> ', 'done'] },
      false
    ],
    ['nothing can be read', { waitIdle: fail, orphaned: fail }, true]
  ] as [string, Partial<TabReads>, boolean][])('%s', async (_name, reads, want) => {
    const all: TabReads = { waitIdle: fail, orphaned: fail, screen: fail, ...reads }
    expect(await tabBusy('term_a', all)).toBe(want)
  })
})

describe('truncated lists', () => {
  it('listBusyTerminals throws on a cut-short terminal list', async () => {
    const runtime = {
      listTerminals: async () => ({ terminals: [], truncated: true, totalCount: 9 })
    }
    await expect(listBusyTerminals(runtime as unknown as BusyRuntime)).rejects.toThrow(
      'terminal list cut short (9 terminals)'
    )
  })

  it('agentStates throws on a cut-short worktree ps', async () => {
    const runtime = {
      getWorktreePs: async () => ({ worktrees: [], truncated: true, totalCount: 5 })
    }
    await expect(runtimeBusyReads(runtime as unknown as BusyRuntime).agentStates()).rejects.toThrow(
      'worktree ps returned 0 of 5 worktrees'
    )
  })
})

describe('runtimeBusyReads', () => {
  it('reads drafts, asks Orca for agent states once, and waits 1.5 s for tui-idle', async () => {
    const runtime = {
      readTerminal: vi.fn(async () => ({ draft: 'hi', tail: [] })),
      getWorktreePs: vi.fn(async () => ({
        worktrees: [{ agents: [{ paneKey: 't1:l1', state: 'working' }] }],
        totalCount: 1,
        truncated: false
      })),
      waitForTerminal: vi.fn(async () => ({ satisfied: true })),
      showTerminal: vi.fn(),
      listTerminals: vi.fn()
    }
    const reads = runtimeBusyReads(runtime as unknown as BusyRuntime)
    expect(await reads.draft('term_a')).toBe('hi')
    expect(runtime.readTerminal).toHaveBeenCalledWith('term_a', { screen: true, limit: 1 })
    expect((await reads.agentStates()).get('t1:l1')).toBe('working')
    await reads.agentStates()
    expect(runtime.getWorktreePs).toHaveBeenCalledTimes(1)
    expect(await reads.tabBusy('term_a')).toBe(false)
    expect(runtime.waitForTerminal).toHaveBeenCalledWith('term_a', {
      condition: 'tui-idle',
      timeoutMs: 1500
    })
  })
})
