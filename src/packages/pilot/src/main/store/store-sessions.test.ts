import { describe, expect, it } from 'vitest'
import { PilotStore } from './store'

describe('AgentSessionStore', () => {
  it('keeps one session per automation, worktree and agent, and forgets it on request', () => {
    const { sessions } = PilotStore.open(':memory:')
    expect(sessions.get('review', '/wt', 'claude')).toBeNull()
    sessions.set('review', '/wt', 'claude', 'sess-1', 10)
    sessions.set('review', '/wt', 'codex', 'sess-2', 11)
    sessions.set('review', '/wt', 'claude', 'sess-3', 12)
    expect(sessions.get('review', '/wt', 'claude')).toEqual({ sessionId: 'sess-3', updatedAt: 12 })
    expect(sessions.get('review', '/wt', 'codex')).toEqual({ sessionId: 'sess-2', updatedAt: 11 })
    expect(sessions.get('other', '/wt', 'claude')).toBeNull()
    sessions.forget('review', '/wt', 'claude')
    expect(sessions.get('review', '/wt', 'claude')).toBeNull()
  })
})
