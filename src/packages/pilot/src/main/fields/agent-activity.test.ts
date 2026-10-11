import { describe, expect, it } from 'vitest'
import {
  worktreeActivity,
  worktreePathKey,
  type ActivityDeps,
  type AgentActivity,
  type AgentTerminal
} from './agent-activity'

const term = (handle: string, worktreePath: string): AgentTerminal => ({
  handle,
  worktreePath,
  paneKey: `tab-${handle}:leaf`
})

function deps(
  terminals: AgentTerminal[],
  states: Record<string, string>,
  drafts: Record<string, string | Error>
): ActivityDeps {
  return {
    agentTerminals: async () => terminals,
    paneState: (paneKey) => {
      const state = states[paneKey]
      if (state === 'throw') {
        throw new Error('rows unavailable')
      }
      return (state ?? 'idle') as 'idle' | 'working' | 'waiting'
    },
    terminalDraft: async (handle) => {
      const draft = drafts[handle]
      if (draft instanceof Error) {
        throw draft
      }
      return draft ?? ''
    }
  }
}

describe('worktreeActivity', () => {
  it.each<
    [string, AgentTerminal[], Record<string, string>, Record<string, string | Error>, AgentActivity]
  >([
    ['no agent tabs', [], {}, {}, { state: 'idle', typing: false }],
    ['an idle agent', [term('t1', '/wt')], {}, {}, { state: 'idle', typing: false }],
    [
      'a working agent beats a waiting one',
      [term('t1', '/wt'), term('t2', '/wt')],
      { 'tab-t1:leaf': 'waiting', 'tab-t2:leaf': 'working' },
      {},
      { state: 'working', typing: false }
    ],
    [
      'an agent waiting for input',
      [term('t1', '/wt')],
      { 'tab-t1:leaf': 'waiting' },
      {},
      { state: 'waiting', typing: false }
    ],
    ['someone typing', [term('t1', '/wt')], {}, { t1: 'fix the' }, { state: 'idle', typing: true }],
    [
      'a blank draft is not typing',
      [term('t1', '/wt')],
      {},
      { t1: '   ' },
      { state: 'idle', typing: false }
    ],
    [
      'an unreadable draft',
      [term('t1', '/wt')],
      {},
      { t1: new Error('terminal_handle_stale') },
      { state: 'idle', typing: null }
    ],
    [
      'typing seen in one tab wins over an unreadable one',
      [term('t1', '/wt'), term('t2', '/wt')],
      {},
      { t1: new Error('x'), t2: 'hi' },
      { state: 'idle', typing: true }
    ],
    [
      'an unreadable agent state',
      [term('t1', '/wt')],
      { 'tab-t1:leaf': 'throw' },
      {},
      { state: null, typing: false }
    ],
    [
      "another worktree's tabs don't count",
      [term('t1', '/other')],
      { 'tab-t1:leaf': 'working' },
      { t1: 'x' },
      { state: 'idle', typing: false }
    ]
  ])('%s', async (_name, terminals, states, drafts, expected) => {
    const out = await worktreeActivity(['/wt'], deps(terminals, states, drafts))
    expect(out?.get('/wt')).toEqual(expected)
  })

  // Orca's terminal list and its worktree list are separate registries: compare paths in one form.
  it('matches terminals to worktrees whatever the trailing slash or dot segments', async () => {
    const terminals = [term('t1', '/wt/a'), term('t2', '/wt/x/../a/'), term('t3', '/wt/ab')]
    const states = { 'tab-t2:leaf': 'working', 'tab-t3:leaf': 'working' }
    const out = await worktreeActivity(['/wt/a/'], deps(terminals, states, { t1: 'hi', t3: 'x' }))
    expect(out?.get('/wt/a')).toEqual({ state: 'working', typing: true })
    expect(worktreePathKey('/wt//a/')).toBe('/wt/a')
  })

  it('returns null when the terminal list cannot be read, so worktree: idle fails closed', async () => {
    const out = await worktreeActivity(['/wt'], {
      ...deps([], {}, {}),
      agentTerminals: async () => {
        throw new Error('runtime_unavailable')
      }
    })
    expect(out).toBeNull()
  })
})
