import { createReadStream } from 'node:fs'
import { readdir, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { createInterface } from 'node:readline'
import { encodeClaudeProjectPaths } from '../../../../../main/ai-vault/claude-project-dir-encoding'
import { inWindow, localDay, type UsageWindow } from './buckets'
import { claudeSubagentFiles } from './claude'

// The sessions a step's agent starts on its own count with the step: `claude -p` and `codex exec` children (job 03's
// orchestrated phases), a hook's SDK session (the security-guidance review) and Codex subagents. A child started in
// the run's folder inside the step's window, isn't interactive, and isn't any step's own session.
export type ChildScope = {
  // The run's folder; null finds only Codex subagents.
  cwd: string | null
  sessionId: string
  window: UsageWindow
  claimed: ReadonlySet<string>
}
export type ChildSessions = { claude: string[]; codex: string[] }
export type ChildPaths = { claudeProjects: string; codexHomes: readonly string[] }

// A Claude transcript names its entrypoint within its first few lines (after any summary or snapshot lines).
const CLAUDE_HEAD_LINES = 20
const DAY_MS = 86_400_000
// Codex names a rollout by its start to the second.
const ROLLOUT_NAME = /^rollout-(\d{4})-(\d{2})-(\d{2})T(\d{2})-(\d{2})-(\d{2})-(.+)\.jsonl$/

type Json = Record<string, unknown>

function isJson(value: unknown): value is Json {
  return typeof value === 'object' && value !== null
}

function parse(line: string): Json | null {
  try {
    const value: unknown = JSON.parse(line)
    return isJson(value) ? value : null
  } catch {
    return null
  }
}

function field(value: unknown, key: string): unknown {
  return isJson(value) ? value[key] : undefined
}

function text(value: unknown): string | null {
  return typeof value === 'string' ? value : null
}

async function headLines(path: string, max: number): Promise<string[]> {
  const input = createReadStream(path, { encoding: 'utf-8' })
  const lines: string[] = []
  const reader = createInterface({ input, crlfDelay: Infinity })
  try {
    for await (const line of reader) {
      lines.push(line)
      if (lines.length >= max) {
        break
      }
    }
  } catch {
    // An unreadable file has no head.
  } finally {
    reader.close()
    input.destroy()
  }
  return lines
}

async function modifiedSince(path: string, from: number): Promise<boolean> {
  try {
    return (await stat(path)).mtimeMs >= from
  } catch {
    return false
  }
}

async function listDir(dir: string): Promise<string[]> {
  try {
    return (await readdir(dir)).sort()
  } catch {
    return []
  }
}

// `claude -p` is sdk-cli, an SDK caller sdk-py or sdk-ts; a session someone types into is cli.
async function isClaudeChild(path: string, scope: ChildScope): Promise<boolean> {
  for (const line of await headLines(path, CLAUDE_HEAD_LINES)) {
    const entry = parse(line)
    const entrypoint = text(entry?.entrypoint)
    const timestamp = text(entry?.timestamp)
    if (entrypoint === null || timestamp === null) {
      continue
    }
    return (
      entrypoint.startsWith('sdk') &&
      text(entry?.cwd) === scope.cwd &&
      inWindow(timestamp, scope.window) !== null
    )
  }
  return false
}

async function claudeChildren(scope: ChildScope, projectsDir: string): Promise<string[]> {
  if (scope.cwd === null) {
    return []
  }
  const files: string[] = []
  for (const folder of encodeClaudeProjectPaths(scope.cwd)) {
    const dir = join(projectsDir, folder)
    for (const name of await listDir(dir)) {
      const id = name.endsWith('.jsonl') ? name.slice(0, -'.jsonl'.length) : null
      if (id === null || id === scope.sessionId || scope.claimed.has(id)) {
        continue
      }
      const path = join(dir, name)
      if ((await modifiedSince(path, scope.window.from)) && (await isClaudeChild(path, scope))) {
        files.push(path, ...(await claudeSubagentFiles(path)))
      }
    }
  }
  return files
}

type Rollout = {
  path: string
  id: string
  cwd: string | null
  exec: boolean
  parent: string | null
}

function rolloutStart(name: string): number | null {
  const m = ROLLOUT_NAME.exec(name)
  if (!m) {
    return null
  }
  const [y, mo, d, h, mi, s] = m.slice(1, 7).map(Number)
  return new Date(y, mo - 1, d, h, mi, s).getTime()
}

function parentOf(meta: Json): string | null {
  const spawn = field(field(meta.source, 'subagent'), 'thread_spawn')
  return text(meta.parent_thread_id) ?? text(field(spawn, 'parent_thread_id'))
}

async function readRollout(path: string): Promise<Rollout | null> {
  const [first] = await headLines(path, 1)
  const line = first ? parse(first) : null
  const meta = line?.type === 'session_meta' && isJson(line.payload) ? line.payload : null
  const id = text(meta?.id)
  if (meta === null || id === null) {
    return null
  }
  return {
    path,
    id,
    cwd: text(meta.cwd),
    exec: meta.originator === 'codex_exec' || meta.source === 'exec',
    parent: parentOf(meta)
  }
}

// Every rollout that started inside the window, oldest first, so a subagent comes after its parent.
async function rolloutsIn(window: UsageWindow, homes: readonly string[]): Promise<Rollout[]> {
  const days: string[] = []
  for (let ms = window.from; localDay(ms) <= localDay(window.to); ms += DAY_MS) {
    days.push(localDay(ms))
  }
  const found: { start: number; rollout: Rollout }[] = []
  for (const home of homes) {
    for (const day of days) {
      const folder = join(home, 'sessions', ...day.split('-'))
      for (const name of await listDir(folder)) {
        const start = rolloutStart(name)
        // The name drops the start's milliseconds.
        if (start === null || start < window.from - 1000 || start > window.to) {
          continue
        }
        const rollout = await readRollout(join(folder, name))
        if (rollout) {
          found.push({ start, rollout })
        }
      }
    }
  }
  return found.sort((a, b) => a.start - b.start).map((f) => f.rollout)
}

async function codexChildren(scope: ChildScope, homes: readonly string[]): Promise<string[]> {
  const counted = new Set([scope.sessionId])
  const files: string[] = []
  for (const r of await rolloutsIn(scope.window, homes)) {
    if (counted.has(r.id) || scope.claimed.has(r.id)) {
      continue
    }
    const subagent = r.parent !== null && counted.has(r.parent)
    const execHere = r.exec && scope.cwd !== null && r.cwd === scope.cwd
    if (subagent || execHere) {
      counted.add(r.id)
      files.push(r.path)
    }
  }
  return files
}

export async function findChildSessions(
  scope: ChildScope,
  paths: ChildPaths
): Promise<ChildSessions> {
  return {
    claude: await claudeChildren(scope, paths.claudeProjects),
    codex: await codexChildren(scope, paths.codexHomes)
  }
}
