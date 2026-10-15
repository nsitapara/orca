import type { LogEntry, LogStatus } from '../../shared/visibility-types'

// Where a record sits in its file, so an entry's full input and output are read back only when asked for.
export type Span = { offset: number; length: number }
// Claude Code's own record of a git action on a Bash result (toolUseResult.gitOperation).
export type GitOperation = {
  push?: { branch?: string }
  pr?: { number?: number; url?: string; action?: string }
}
// A log line plus what the reader keeps for it: where its records are, and what effects read.
export type ParsedEntry = LogEntry & {
  use: Span
  result: Span | null
  command: string | null
  git: GitOperation | null
  ids: string[]
  // The record's gitBranch: where a push that names no branch went.
  branch: string | null
}
export type LogState = { offset: number; entries: ParsedEntry[]; open: Map<string, ParsedEntry> }

type Block = {
  type?: string
  id?: string
  name?: string
  input?: unknown
  text?: string
  tool_use_id?: string
  content?: unknown
  is_error?: boolean
}
type Rec = {
  type?: string
  isSidechain?: boolean
  timestamp?: string
  uuid?: string
  cwd?: string
  gitBranch?: unknown
  message?: { content?: unknown }
  toolUseResult?: unknown
}
type Patch = { added: number; removed: number }
type Extra = { interrupted: boolean; git: GitOperation | null; patch: Patch | null }

export const TITLE_CHARS = 200
const SUMMARY_CHARS = 120
const MAX_LINKS = 10
const LINK = /https?:\/\/[^\s"'<>()[\]{}`\\]+/g
const KEPT_LINK = /\/-\/(?:merge_requests|pipelines|jobs)\/\d+|linear\.app\/[^/]+\/issue\//
const IDENTIFIER = /"identifier"\s*:\s*"([A-Z][A-Z0-9]{1,9}-\d+)"/g
const ISSUE_URL = /linear\.app\/[^/]+\/issue\/([A-Z][A-Z0-9]{1,9}-\d+)/
const NO_EXTRA: Extra = { interrupted: false, git: null, patch: null }
const WEB_LINK = /^https?:\/\//

export function emptyLog(): LogState {
  return { offset: 0, entries: [], open: new Map() }
}

function clip(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max - 1)}…` : text
}

function firstLine(text: string): string {
  return clip(text.trim().split('\n')[0] ?? '', TITLE_CHARS)
}

function relative(path: string, cwd: string | null): string {
  return cwd && path.startsWith(`${cwd}/`) ? path.slice(cwd.length + 1) : path
}

// The one-line title of a tool call (spec §1 Entries).
export function toolTitle(
  name: string,
  input: Record<string, unknown>,
  cwd: string | null
): string {
  const str = (key: string): string =>
    typeof input[key] === 'string' ? (input[key] as string) : ''
  if (name === 'Bash') {
    return `$ ${firstLine(str('command'))}`
  }
  if (name === 'Read' || name === 'Edit' || name === 'Write' || name === 'NotebookEdit') {
    return `${name} ${relative(str('file_path') || str('notebook_path'), cwd)}`
  }
  if (name === 'Grep' || name === 'Glob') {
    return `${name} ${str('pattern')}`
  }
  if (name === 'Skill') {
    return ['Skill', str('skill'), str('args')].filter(Boolean).join(' ')
  }
  if (name === 'Agent' || name === 'Task') {
    return `Agent ${str('description')}`
  }
  return name
}

function isBlock(value: unknown): value is Block {
  return Boolean(value) && typeof value === 'object'
}

function partText(p: unknown): string {
  if (!isBlock(p)) {
    return ''
  }
  if (p.type === 'text' && typeof p.text === 'string') {
    return p.text
  }
  return p.type === 'image' ? '(image)' : ''
}

// A tool_result's text: a string, or its text parts joined (an image reads "(image)").
export function resultText(content: unknown): string {
  if (typeof content === 'string') {
    return content
  }
  if (!Array.isArray(content)) {
    return ''
  }
  return content.map(partText).filter(Boolean).join('\n')
}

function hunkLines(hunk: unknown): unknown[] {
  const lines = hunk && typeof hunk === 'object' ? (hunk as { lines?: unknown }).lines : null
  return Array.isArray(lines) ? lines : []
}

// A Write that created its file has no hunks: no patch, so its summary is the result's text.
function patchOf(hunks: unknown): Patch | null {
  if (!Array.isArray(hunks) || hunks.length === 0) {
    return null
  }
  const lines = hunks.flatMap(hunkLines).filter((l): l is string => typeof l === 'string')
  return {
    added: lines.filter((l) => l.startsWith('+')).length,
    removed: lines.filter((l) => l.startsWith('-')).length
  }
}

function extraOf(value: unknown): Extra {
  if (!value || typeof value !== 'object') {
    return NO_EXTRA
  }
  const v = value as { interrupted?: unknown; gitOperation?: unknown; structuredPatch?: unknown }
  const git =
    v.gitOperation && typeof v.gitOperation === 'object' ? (v.gitOperation as GitOperation) : null
  return { interrupted: v.interrupted === true, git, patch: patchOf(v.structuredPatch) }
}

function statusOf(isError: boolean, interrupted: boolean): LogStatus {
  if (interrupted) {
    return 'interrupted'
  }
  return isError ? 'error' : 'ok'
}

function summaryOf(status: LogStatus, text: string, patch: Patch | null): string | null {
  if (patch) {
    return `+${patch.added} −${patch.removed}`
  }
  const lines = text
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
  const exit = status === 'error' ? /^Exit code (\d+)$/.exec(lines[0] ?? '') : null
  if (exit) {
    return clip(lines[1] ? `exit ${exit[1]} · ${lines[1]}` : `exit ${exit[1]}`, SUMMARY_CHARS)
  }
  if (lines.length > 1) {
    return `${lines.length} lines`
  }
  return lines[0] ? clip(lines[0], SUMMARY_CHARS) : null
}

function linksOf(text: string, git: GitOperation | null): string[] {
  const found = (text.match(LINK) ?? [])
    .map((l) => l.replace(/[.,;:]+$/, ''))
    .filter((l) => KEPT_LINK.test(l))
  const pr = git?.pr?.url
  const kept = typeof pr === 'string' && WEB_LINK.test(pr) ? [pr, ...found] : found
  return [...new Set(kept)].slice(0, MAX_LINKS)
}

function idsOf(text: string, links: readonly string[]): string[] {
  const fromJson = [...text.matchAll(IDENTIFIER)].map((m) => m[1])
  const fromLinks = links
    .map((l) => ISSUE_URL.exec(l)?.[1])
    .filter((id): id is string => Boolean(id))
  return [...new Set([...fromJson, ...fromLinks])].slice(0, MAX_LINKS)
}

function toolEntry(b: Block, rec: Rec, at: number, span: Span): ParsedEntry {
  const name = typeof b.name === 'string' ? b.name : 'tool'
  const input = b.input && typeof b.input === 'object' ? (b.input as Record<string, unknown>) : {}
  return {
    kind: 'tool',
    id: String(b.id),
    at,
    tool: name,
    title: toolTitle(name, input, rec.cwd ?? null),
    status: 'pending',
    summary: null,
    links: [],
    use: span,
    result: null,
    command: name === 'Bash' && typeof input.command === 'string' ? input.command : null,
    git: null,
    ids: [],
    branch: typeof rec.gitBranch === 'string' && rec.gitBranch ? rec.gitBranch : null
  }
}

function addAssistant(state: LogState, rec: Rec, content: unknown[], at: number, span: Span): void {
  content.forEach((b, i) => {
    if (!isBlock(b)) {
      return
    }
    if (b.type === 'tool_use' && typeof b.id === 'string') {
      const entry = toolEntry(b, rec, at, span)
      state.entries.push(entry)
      state.open.set(b.id, entry)
      return
    }
    if (b.type === 'text' && typeof b.text === 'string' && b.text.trim()) {
      state.entries.push({
        kind: 'text',
        id: `${rec.uuid ?? span.offset}:${i}`,
        at,
        title: firstLine(b.text),
        use: span,
        result: null,
        command: null,
        git: null,
        ids: [],
        branch: null
      })
    }
  })
}

function addResults(state: LogState, rec: Rec, content: unknown[], span: Span): void {
  const results = content.filter(isBlock).filter((b) => b.type === 'tool_result')
  // toolUseResult describes a record's one result; a record with several can't say which it belongs to.
  const extra = results.length === 1 ? extraOf(rec.toolUseResult) : NO_EXTRA
  for (const b of results) {
    const entry = state.open.get(String(b.tool_use_id))
    if (!entry || entry.kind !== 'tool') {
      continue
    }
    state.open.delete(String(b.tool_use_id))
    const text = resultText(b.content)
    entry.result = span
    entry.status = statusOf(b.is_error === true, extra.interrupted)
    entry.summary = summaryOf(entry.status, text, extra.patch)
    entry.git = extra.git
    entry.links = linksOf(text, extra.git)
    entry.ids = idsOf(text, entry.links)
  }
}

function parsed(line: string): Rec | null {
  try {
    const rec: unknown = JSON.parse(line)
    return rec && typeof rec === 'object' ? (rec as Rec) : null
  } catch {
    return null
  }
}

function applyLine(state: LogState, line: string, span: Span): void {
  const rec = parsed(line)
  if (!rec || rec.isSidechain === true) {
    return
  }
  const at = Date.parse(String(rec.timestamp ?? ''))
  const content = rec.message?.content
  if (Number.isNaN(at) || !Array.isArray(content)) {
    return
  }
  if (rec.type === 'assistant') {
    addAssistant(state, rec, content, at, span)
  }
  if (rec.type === 'user') {
    addResults(state, rec, content, span)
  }
}

// Reads the bytes that follow state.offset. Only complete lines count, so a half-written last line is read again next
// time.
export function feed(state: LogState, chunk: Buffer): void {
  let start = 0
  let nl = chunk.indexOf(0x0a, start)
  while (nl >= 0) {
    try {
      applyLine(state, chunk.subarray(start, nl).toString('utf8'), {
        offset: state.offset + start,
        length: nl - start
      })
    } catch {
      // A record of a shape the parser doesn't know is skipped, so the offset still moves past it.
    }
    start = nl + 1
    nl = chunk.indexOf(0x0a, start)
  }
  state.offset += start
}

// The entries inside a step's window, and how many come after it (a resumed session's, not the run's).
export function inWindow(
  entries: readonly ParsedEntry[],
  from: number,
  to: number | null
): { inside: ParsedEntry[]; later: number } {
  if (to === null) {
    return { inside: entries.filter((e) => e.at >= from), later: 0 }
  }
  return {
    inside: entries.filter((e) => e.at >= from && e.at <= to),
    later: entries.filter((e) => e.at > to).length
  }
}
