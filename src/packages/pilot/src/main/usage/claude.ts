import { readdir } from 'node:fs/promises'
import { basename, dirname, join } from 'node:path'
import { estimateCostUsd } from '../../../../../main/claude-usage/claude-model-pricing'
import { parseClaudeUsageFile } from '../../../../../main/claude-usage/transcript-record-parser'
import type { ClaudeUsageParsedTurn } from '../../../../../main/claude-usage/types'
import { BucketSet, fileExists, inWindow, type UsageBucket, type UsageWindow } from './buckets'

type Turn = Pick<
  ClaudeUsageParsedTurn,
  | 'timestamp'
  | 'model'
  | 'inputTokens'
  | 'outputTokens'
  | 'cacheReadTokens'
  | 'cacheWriteTokens'
  | 'cacheWrite1hTokens'
>
export type ClaudeParse = (path: string) => Promise<Turn[]>
type Estimate = typeof estimateCostUsd

// The session's own transcript: the path its hook reported, else <projects>/<any folder>/<session>.jsonl, the
// way usage.py's claude_files finds a pinned session.
export async function findClaudeTranscript(
  sessionId: string,
  hinted: string | null,
  projectsDir: string
): Promise<string | null> {
  if (hinted && (await fileExists(hinted))) {
    return hinted
  }
  let folders: string[]
  try {
    folders = await readdir(projectsDir)
  } catch {
    return null
  }
  for (const folder of folders.sort()) {
    const candidate = join(projectsDir, folder, `${sessionId}.jsonl`)
    if (await fileExists(candidate)) {
      return candidate
    }
  }
  return null
}

// A session's subagents count with it: <transcript folder>/<transcript stem>/subagents/**/*.jsonl.
export async function claudeSubagentFiles(transcript: string): Promise<string[]> {
  const root = join(dirname(transcript), basename(transcript, '.jsonl'), 'subagents')
  let names: string[]
  try {
    names = await readdir(root, { recursive: true })
  } catch {
    return []
  }
  return names
    .filter((n) => n.endsWith('.jsonl'))
    .sort()
    .map((n) => join(root, n))
}

// Never throws: a file it can't read adds nothing.
export async function claudeUsage(
  files: readonly string[],
  window: UsageWindow,
  parse: ClaudeParse = parseClaudeUsageFile,
  estimate: Estimate = estimateCostUsd
): Promise<UsageBucket[]> {
  const buckets = new BucketSet('claude')
  for (const file of files) {
    let turns: Turn[]
    try {
      turns = await parse(file)
    } catch {
      continue
    }
    for (const t of turns) {
      const ms = inWindow(t.timestamp, window)
      if (ms === null || !t.model || t.model === '<synthetic>') {
        continue
      }
      buckets.add(ms, t.model, {
        requests: 1,
        input: t.inputTokens,
        cacheRead: t.cacheReadTokens,
        cacheWrite: t.cacheWriteTokens,
        output: t.outputTokens,
        costUsd: estimate(t.model, t)
      })
    }
  }
  return buckets.list()
}
