import type Database from '../../../../../main/sqlite/sync-database'

// session: per_worktree (contract §7): the session one automation's agent keeps in one worktree.
export class AgentSessionStore {
  constructor(private readonly db: Database) {}

  get(
    automationId: string,
    worktreePath: string,
    agent: string
  ): { sessionId: string; updatedAt: number } | null {
    const r = this.db
      .prepare(
        'SELECT session_id, updated_at FROM agent_sessions WHERE automation_id = ? AND worktree_path = ? AND agent = ?'
      )
      .get(automationId, worktreePath, agent)
    if (!r) {
      return null
    }
    return { sessionId: String(r.session_id), updatedAt: Number(r.updated_at) }
  }

  set(
    automationId: string,
    worktreePath: string,
    agent: string,
    sessionId: string,
    at: number
  ): void {
    this.db
      .prepare(
        'INSERT OR REPLACE INTO agent_sessions (automation_id, worktree_path, agent, session_id, updated_at) VALUES (?, ?, ?, ?, ?)'
      )
      .run(automationId, worktreePath, agent, sessionId, at)
  }

  forget(automationId: string, worktreePath: string, agent: string): void {
    this.db
      .prepare(
        'DELETE FROM agent_sessions WHERE automation_id = ? AND worktree_path = ? AND agent = ?'
      )
      .run(automationId, worktreePath, agent)
  }
}
