import { basename } from 'node:path'
import type { ImportedSession } from '../../../shared/api-types'
import type { StateReader } from './types'

const TAB_FILES: { file: string; agent: 'claude' | 'codex' }[] = [
  { file: 'tabs.json', agent: 'claude' },
  { file: 'tabs-codex.json', agent: 'codex' }
]

// gate.tabs_file: each loop keeps { "<worktree path>": "<terminal handle>" } per agent.
export function tabSessions(
  read: StateReader,
  loop: string
): { sessions: ImportedSession[]; notes: string[] } {
  const sessions: ImportedSession[] = []
  const notes: string[] = []
  for (const { file, agent } of TAB_FILES) {
    const data = read.json(`${loop}/${file}`)
    if (data === null) {
      continue
    }
    if (typeof data !== 'object' || Array.isArray(data)) {
      notes.push(`${loop}/${file}: expected { "<worktree path>": "<terminal handle>" }`)
      continue
    }
    for (const [path, handle] of Object.entries(data as Record<string, unknown>)) {
      if (typeof handle === 'string' && handle.length > 0) {
        sessions.push({ worktreePath: path, terminalHandle: handle, agent, label: basename(path) })
      } else {
        notes.push(`${loop}/${file}: skipped ${path}: ${JSON.stringify(handle)}`)
      }
    }
  }
  return { sessions, notes }
}
