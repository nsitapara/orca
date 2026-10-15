import type { LogEntry, LogEntryDetail, StepLog } from '../../shared/visibility-types'
import type { PilotStore } from '../store/store'
import { findClaudeTranscript } from '../usage/claude'
import { inWindow, resultText, type ParsedEntry } from './claude-log'
import { NOT_UNDER_ROOT, type LogReader } from './log-file'

export const MAX_LOG_ENTRIES = 2000
export const MAX_DETAIL_CHARS = 256 * 1024
export const CODEX_NOT_READ = "Codex logs aren't read yet: Resume opens the session"
export const NOT_AN_AGENT = 'Only agent steps have a log'
export const TRANSCRIPT_CHANGED = 'The transcript changed since the log was read; reload it'
export const NO_TRANSCRIPT = 'No transcript was found for this session'

export type StepLogDeps = { store: PilotStore; reader: LogReader; claudeProjects: string }
type Located = { path: string; from: number; to: number | null }
type Block = {
  type?: string
  id?: string
  input?: unknown
  text?: string
  tool_use_id?: string
  content?: unknown
}

function none(reason: string): StepLog {
  return { source: 'none', reason, entries: [], truncatedBefore: 0, later: 0 }
}

// The step's transcript and window, or why it has no log.
async function locate(
  deps: StepLogDeps,
  runId: string,
  stepIdx: number
): Promise<Located | { reason: string }> {
  const run = deps.store.runs.get(runId)
  const step = deps.store.runs.steps(runId).find((s) => s.idx === stepIdx)
  if (!run || !step) {
    throw new Error(`No step ${stepIdx} in run "${runId}"`)
  }
  if (step.agent === 'codex') {
    return { reason: CODEX_NOT_READ }
  }
  if (step.agent !== 'claude') {
    return { reason: NOT_AN_AGENT }
  }
  const path = step.sessionId
    ? await findClaudeTranscript(step.sessionId, step.transcriptPath, deps.claudeProjects)
    : null
  if (!path) {
    return { reason: NO_TRANSCRIPT }
  }
  return { path, from: step.startedAt ?? run.startedAt, to: step.finishedAt }
}

function shown(e: ParsedEntry): LogEntry {
  if (e.kind === 'text') {
    return { kind: 'text', id: e.id, at: e.at, title: e.title }
  }
  const { kind, id, at, tool, title, status, summary, links } = e
  return { kind, id, at, tool, title, status, summary, links }
}

// pilot.runs.log: the step's condensed log inside its window (spec §1).
export async function stepLog(deps: StepLogDeps, runId: string, stepIdx: number): Promise<StepLog> {
  const where = await locate(deps, runId, stepIdx)
  if ('reason' in where) {
    return none(where.reason)
  }
  let state
  try {
    state = await deps.reader.read(where.path)
  } catch (error) {
    return none(
      error instanceof Error && error.message === NOT_UNDER_ROOT ? NOT_UNDER_ROOT : NO_TRANSCRIPT
    )
  }
  const { inside, later } = inWindow(state.entries, where.from, where.to)
  const kept = inside.slice(-MAX_LOG_ENTRIES)
  return {
    source: 'claude',
    reason: null,
    entries: kept.map(shown),
    truncatedBefore: inside.length - kept.length,
    later
  }
}

function tail(text: string): { text: string; cut: number } {
  if (text.length <= MAX_DETAIL_CHARS) {
    return { text, cut: 0 }
  }
  return { text: text.slice(-MAX_DETAIL_CHARS), cut: text.length - MAX_DETAIL_CHARS }
}

function blocks(line: string): Block[] {
  const rec = JSON.parse(line) as { message?: { content?: unknown } }
  const content = rec.message?.content
  return Array.isArray(content) ? (content as Block[]) : []
}

function inputOf(block: Block | undefined): string {
  const input = (block?.input ?? {}) as Record<string, unknown>
  if (typeof input.command === 'string') {
    return typeof input.description === 'string'
      ? `${input.command}\n\n# ${input.description}`
      : input.command
  }
  return JSON.stringify(input, null, 2)
}

// pilot.runs.logEntry: one entry's full input and output, read from the file when asked; each side keeps its last
// MAX_DETAIL_CHARS.
export async function stepLogEntry(
  deps: StepLogDeps,
  runId: string,
  stepIdx: number,
  id: string
): Promise<LogEntryDetail> {
  const where = await locate(deps, runId, stepIdx)
  if ('reason' in where) {
    throw new Error(where.reason)
  }
  const state = await deps.reader.read(where.path).catch((error: unknown) => {
    throw new Error(
      error instanceof Error && error.message === NOT_UNDER_ROOT
        ? NOT_UNDER_ROOT
        : TRANSCRIPT_CHANGED
    )
  })
  const entry = inWindow(state.entries, where.from, where.to).inside.find((e) => e.id === id)
  if (!entry) {
    throw new Error(`No log entry "${id}" in this step`)
  }
  try {
    return await detailOf(deps, where.path, entry, id)
  } catch {
    throw new Error(TRANSCRIPT_CHANGED)
  }
}

// The entry's input and output, cut to their tails.
async function detailOf(
  deps: StepLogDeps,
  path: string,
  entry: ParsedEntry,
  id: string
): Promise<LogEntryDetail> {
  const used = blocks(await deps.reader.span(path, entry.use))
  if (entry.kind === 'text') {
    const index = Number(id.split(':').pop())
    const out = tail(used[index]?.text ?? '')
    return { input: '', output: out.text, inputCut: 0, outputCut: out.cut }
  }
  const input = tail(inputOf(used.find((b) => b.type === 'tool_use' && b.id === id)))
  const results = entry.result ? blocks(await deps.reader.span(path, entry.result)) : []
  const output = tail(resultText(results.find((b) => b.tool_use_id === id)?.content))
  return { input: input.text, output: output.text, inputCut: input.cut, outputCut: output.cut }
}
