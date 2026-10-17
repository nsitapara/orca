// A Claude or Codex session id: the UUID shape both produce (Claude a v4, Codex a v7 in its rollout name).
// An id comes back from an agent's hooks and later becomes `--resume <id>` / `codex resume <id>`, so
// anything else (a flag, a space, a path) is never stored nor put in argv.
const SESSION_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export function isSessionId(id: unknown): id is string {
  return typeof id === 'string' && SESSION_ID.test(id)
}

export const NOT_A_SESSION_ID = 'is not a session id'
