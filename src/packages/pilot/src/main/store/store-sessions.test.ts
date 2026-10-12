import { describe, expect, it } from 'vitest'
import { PilotStore } from './store'

describe('AgentSessionStore', () => {
  it('keeps one session per automation, worktree and agent, and forgets it on request', () => {
    const { sessions } = PilotStore.open(':memory:')
    expect(sessions.get('review', '/wt', 'claude')).toBeNull()
    sessions.set('review', '/wt', 'claude', '00000000-0000-4000-8000-000000000001', 10)
    sessions.set('review', '/wt', 'codex', '00000000-0000-4000-8000-000000000002', 11)
    sessions.set('review', '/wt', 'claude', '00000000-0000-4000-8000-000000000003', 12)
    expect(sessions.get('review', '/wt', 'claude')).toEqual({
      sessionId: '00000000-0000-4000-8000-000000000003',
      updatedAt: 12
    })
    expect(sessions.get('review', '/wt', 'codex')).toEqual({
      sessionId: '00000000-0000-4000-8000-000000000002',
      updatedAt: 11
    })
    expect(sessions.get('other', '/wt', 'claude')).toBeNull()
    sessions.forget('review', '/wt', 'claude')
    expect(sessions.get('review', '/wt', 'claude')).toBeNull()
  })
})
