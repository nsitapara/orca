import { describe, expect, it, vi } from 'vitest'
import {
  listBusyTerminals,
  runtimeBusyReads,
  tabBusy,
  REST_QUIET_MS,
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

// A turn that ended with background work left reads working + monitoring; only its main agent says the turn is over.
describe('worktreeBusy on a monitoring agent', () => {
  const main = (state: string) => ({ state, stateStartedAt: 1 })
  const working = { typing: false, reason: '✳ Fix is working' }
  type Busy = { typing: boolean; reason: string } | null
  it.each<[string, Record<string, unknown>, string, Busy]>([
    ['its main agent done: the turn is over', { mainAgent: main('done') }, '', null],
    ['its main agent working', { mainAgent: main('working') }, '', working],
    ['no main agent', {}, '', working],
    ['a null main agent', { mainAgent: null }, '', working],
    [
      'not monitoring (live child agents), its main agent done',
      { workingMode: undefined, mainAgent: main('done') },
      '',
      working
    ],
    [
      'its main agent done, someone typing',
      { mainAgent: main('done') },
      'push it',
      { typing: true, reason: 'someone is typing in ✳ Fix' }
    ]
  ])('%s', async (_name, row, draft, want) => {
    const runtime = {
      readTerminal: async () => ({ draft, tail: [] }),
      getWorktreePs: async () => ({
        worktrees: [
          { agents: [{ paneKey: 't1:l1', state: 'working', workingMode: 'monitoring', ...row }] }
        ],
        totalCount: 1,
        truncated: false
      }),
      // A tui-idle look would call it busy: a turn over is never looked at.
      waitForTerminal: async () => ({ satisfied: false })
    }
    const reads = runtimeBusyReads(runtime as unknown as BusyRuntime)
    expect(await worktreeBusy('/wt/x', [TAB], reads)).toEqual(want)
  })
})

describe('tabBusy (gate.tab_busy)', () => {
  const fail = async (): Promise<never> => {
    throw new Error('timeout')
  }
  const NOW = 1_800_000_000_000
  const live = (lastOutputAt: number | null) => async () => ({ orphaned: false, lastOutputAt })
  const orphaned = async () => ({ orphaned: true, lastOutputAt: null })
  const quiet = live(NOW - REST_QUIET_MS - 60_000)
  const rule = '\u2500'.repeat(30)
  it.each([
    ['Orca says the TUI is idle', { waitIdle: async () => true }, false],
    ['Orca says it is not idle', { waitIdle: async () => false }, true],
    ['the wait fails on a live pane', { show: live(null), screen: async () => ['done'] }, true],
    [
      "an orphaned tab showing Claude's spinner",
      { show: orphaned, screen: async () => ['\u273d Symbioting\u2026 (7m 39s \u00b7 esc'] },
      true
    ],
    [
      "an orphaned tab showing Codex's footer",
      { show: orphaned, screen: async () => ['  esc to interrupt'] },
      true
    ],
    [
      'an orphaned tab at a quiet prompt',
      { show: orphaned, screen: async () => ['> ', 'done'] },
      false
    ],
    // No hook state and a wait that times out: a live tab is free once its screen has rested, quiet for
    // REST_QUIET_MS with Claude's input box empty at its bottom (2026-10-29).
    [
      "no hook state, Claude's box empty and quiet",
      {
        show: quiet,
        screen: async () => ['\u273b Worked for 2m 8s', rule, '\u276f', rule, '  web-2404 | Opus']
      },
      false
    ],
    [
      "no hook state, Claude's box empty, output a minute ago",
      { show: live(NOW - 60_000), screen: async () => [rule, '\u276f', rule, '  web-2404 | Opus'] },
      true
    ],
    [
      'no hook state, quiet, a turn running above the box',
      {
        show: quiet,
        screen: async () => [
          '\u273d Symbioting\u2026 (7m 39s \u00b7 esc to interrupt)',
          rule,
          '\u276f',
          rule
        ]
      },
      true
    ],
    [
      'no hook state, quiet, a permission dialog in place of the box',
      { show: quiet, screen: async () => ['Do you want to proceed?', '\u276f 1. Yes', '  2. No'] },
      true
    ],
    [
      'no hook state, quiet, the box scrolled off the bottom',
      { show: quiet, screen: async () => [rule, '\u276f', rule, ...Array<string>(12).fill('x')] },
      true
    ],
    [
      'no hook state, quiet, the prompt with no rule over it',
      { show: quiet, screen: async () => ['some output', '\u276f'] },
      true
    ],
    ['nothing can be read', { show: fail }, true]
  ] as [string, Partial<TabReads>, boolean][])('%s', async (_name, reads, want) => {
    const all: TabReads = { waitIdle: fail, show: fail, screen: fail, ...reads }
    expect(await tabBusy('term_a', all, NOW)).toBe(want)
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
