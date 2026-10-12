type Seen = { id: string; transcriptPath: string | null } | null
type Owned = { sessionId: string | null; transcriptPath: string | null }

// Which session a step owns. An id already on the step never changes: Claude's is pinned before launch
// (--session-id), and a Codex step, whose CLI can't take an id, keeps the first one its pane's hooks report. A
// later /new or another session in that tab never re-points it; only a missing transcript path is filled in.
export function sessionPatch(
  step: Owned,
  seen: Seen
): { sessionId?: string; transcriptPath?: string } | null {
  if (!seen) {
    return null
  }
  if (step.sessionId === null) {
    return seen.transcriptPath
      ? { sessionId: seen.id, transcriptPath: seen.transcriptPath }
      : { sessionId: seen.id }
  }
  if (
    seen.id !== step.sessionId ||
    !seen.transcriptPath ||
    seen.transcriptPath === step.transcriptPath
  ) {
    return null
  }
  return { transcriptPath: seen.transcriptPath }
}
