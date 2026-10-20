import { createReadStream } from 'node:fs'
import { readdir } from 'node:fs/promises'
import { basename, join } from 'node:path'
import { createInterface } from 'node:readline'
import { LONG_CONTEXT_THRESHOLD_TOKENS } from '../../../../../main/codex-usage/codex-model-pricing'
import { estimateCostUsd } from '../../../../../main/codex-usage/codex-usage-cost-estimate'
import {
  parseCodexUsageRecord,
  type CodexUsageParseContext
} from '../../../../../main/codex-usage/codex-usage-record-parser'
import {
  BucketSet,
  fileExists,
  inWindow,
  localDay,
  type UsageBucket,
  type UsageWindow
} from './buckets'

export type LineReader = (path: string) => AsyncIterable<string>
type Estimate = typeof estimateCostUsd

export function fileLines(path: string): AsyncIterable<string> {
  return createInterface({
    input: createReadStream(path, { encoding: 'utf-8' }),
    crlfDelay: Infinity
  })
}

const DAY_MS = 86_400_000
// A session resumed later keeps growing the rollout in its first day's folder, so look back a week before the step.
const DAY_OFFSETS = [0, 1, -1, -2, -3, -4, -5, -6, -7]

// Codex names a rollout rollout-<local time>-<session id>.jsonl under <home>/sessions/YYYY/MM/DD. The hook's
// path wins; else the start day, the next one and the seven before are searched in each home.
export async function findCodexRollout(
  sessionId: string,
  hinted: string | null,
  startedAt: number,
  homes: readonly string[]
): Promise<string | null> {
  if (hinted && (await fileExists(hinted))) {
    return hinted
  }
  for (const home of homes) {
    for (const offset of DAY_OFFSETS) {
      const [y, m, d] = localDay(startedAt + offset * DAY_MS).split('-')
      const folder = join(home, 'sessions', y, m, d)
      let names: string[]
      try {
        names = await readdir(folder)
      } catch {
        continue
      }
      const hit = names.find((n) => n.startsWith('rollout-') && n.endsWith(`${sessionId}.jsonl`))
      if (hit) {
        return join(folder, hit)
      }
    }
  }
  return null
}

type RawLine = { timestamp?: string; type?: string; payload?: Record<string, unknown> }

function rawLine(line: string): RawLine | null {
  if (!line.includes('"turn_context"') && !line.includes('"token_usage_record"')) {
    return null
  }
  try {
    return JSON.parse(line) as RawLine
  } catch {
    return null
  }
}

function count(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0
}

// usage.py's _add_codex for one token_usage_record: input is the uncached part, cache read the cached part this
// request didn't write; the price is long-context when the request's input is over the threshold.
function recordRow(model: string | null, usage: unknown, estimate: Estimate) {
  const u = (usage ?? {}) as Record<string, unknown>
  const input = count(u.input_tokens)
  const cached = Math.min(count(u.cached_input_tokens), input)
  const write = count(u.cache_write_input_tokens)
  const output = count(u.output_tokens)
  const long = input > LONG_CONTEXT_THRESHOLD_TOKENS
  return {
    requests: 1,
    input: Math.max(input - cached, 0),
    cacheRead: Math.max(cached - write, 0),
    cacheWrite: write,
    output,
    costUsd: estimate(model, {
      inputTokens: input,
      cachedInputTokens: cached,
      outputTokens: output,
      longContextInputTokens: long ? input : 0,
      longContextCachedInputTokens: long ? cached : 0,
      longContextOutputTokens: long ? output : 0
    })
  }
}

// usage.py's parse_codex, inside the step's window: the rollout's own token_usage_records (another thread's are a
// forked subagent's copied history), once per response_id, priced with their turn's model. A rollout with none (written
// before Codex wrote them) counts its token_count events instead, through upstream's parser, which must see every line
// in order (it carries the session id, the model and the running totals). Never throws: what was read before a failure
// still counts.
export async function codexUsage(
  path: string,
  window: UsageWindow,
  lines: LineReader = fileLines,
  estimate: Estimate = estimateCostUsd
): Promise<UsageBucket[]> {
  const context: CodexUsageParseContext = {
    sessionId: basename(path, '.jsonl'),
    sessionCwd: null,
    currentCwd: null,
    currentModel: null,
    previousTotals: null
  }
  const turnModels = new Map<string, string>()
  const responses = new Set<string>()
  const records = new BucketSet('codex')
  const counts = new BucketSet('codex')
  try {
    for await (const line of lines(path)) {
      const event = parseCodexUsageRecord(line, context)
      if (event) {
        const ms = inWindow(event.timestamp, window)
        if (ms !== null) {
          counts.add(ms, event.model ?? 'unknown', {
            requests: 1,
            input: Math.max(event.inputTokens - event.cachedInputTokens, 0),
            cacheRead: event.cachedInputTokens,
            cacheWrite: 0,
            output: event.outputTokens,
            costUsd: estimate(event.model, event)
          })
        }
        continue
      }
      const raw = rawLine(line)
      if (!raw?.payload) {
        continue
      }
      const turn = typeof raw.payload.turn_id === 'string' ? raw.payload.turn_id : null
      if (raw.type === 'turn_context') {
        if (turn && context.currentModel) {
          turnModels.set(turn, context.currentModel)
        }
        continue
      }
      const thread = raw.payload.thread_id
      const response = typeof raw.payload.response_id === 'string' ? raw.payload.response_id : ''
      if (
        raw.type !== 'token_usage_record' ||
        (thread != null && thread !== context.sessionId) ||
        responses.has(response)
      ) {
        continue
      }
      responses.add(response)
      const ms = raw.timestamp ? inWindow(raw.timestamp, window) : null
      if (ms === null) {
        continue
      }
      const model = (turn ? turnModels.get(turn) : undefined) ?? context.currentModel
      records.add(ms, model ?? 'unknown', recordRow(model, raw.payload.usage, estimate))
    }
  } catch {
    // An unreadable or vanished rollout: keep what was read.
  }
  return responses.size > 0 ? records.list() : counts.list()
}
