import type { QuotaReading } from './quota'

type CodexWindow = { usedPercent?: number; windowDurationMins?: number; resetsAt?: number | null }
type ReadWindow = CodexWindow & { usedPercent: number; windowDurationMins: number }
const UNKNOWN: QuotaReading = { weekly: null, session: null }

// What `codex app-server` answers to account/rateLimits/read (the fields quota.py reads).
export type CodexRateLimitsResult = {
  ordinaryUsageAllowed?: boolean
  rateLimits?: {
    primary?: CodexWindow | null
    secondary?: CodexWindow | null
    rateLimitReachedType?: string | null
  } | null
}

const WEEKLY_MINUTES = 1440

function readable(w: CodexWindow): w is ReadWindow {
  return typeof w.usedPercent === 'number' && typeof w.windowDurationMins === 'number'
}

function resetMs(w: CodexWindow): number | null {
  return typeof w.resetsAt === 'number' ? w.resetsAt * 1000 : null
}

// quota.py codex_limits + out_reason as two percentages the quota check compares with its ceilings.
export function codexQuotaReading(result: CodexRateLimitsResult, nowMs: number): QuotaReading {
  const limits: NonNullable<CodexRateLimitsResult['rateLimits']> = result.rateLimits ?? {}
  const present = [limits.primary, limits.secondary].filter((w): w is CodexWindow => Boolean(w))
  // quota.py indexes usedPercent and windowDurationMins: a window lacking either is a KeyError there,
  // so the whole reading is unknown (the check lets the job run), never a partial one.
  if (!present.every(readable)) {
    return UNKNOWN
  }
  const windows = present
  let weekly: number | null = null
  let session: number | null = null
  for (const w of windows) {
    const reset = resetMs(w)
    if (reset !== null && reset <= nowMs) {
      continue // a limit past its reset no longer counts
    }
    if (w.windowDurationMins >= WEEKLY_MINUTES) {
      weekly = Math.max(weekly ?? 0, w.usedPercent)
    } else {
      session = Math.max(session ?? 0, w.usedPercent)
    }
  }
  // Codex itself says it is out; its window may read under the ceiling while its credits are spent.
  const out = result.ordinaryUsageAllowed === false || Boolean(limits.rateLimitReachedType)
  const resets = windows.map(resetMs).filter((r): r is number => r !== null)
  const outResets = resets.length > 0 ? Math.max(...resets) : null
  if (out && !(outResets !== null && outResets <= nowMs)) {
    weekly = 100
  }
  return { weekly, session }
}

function rateLimitsIn(line: string): CodexRateLimitsResult | null {
  if (!line) {
    return null
  }
  try {
    const message = JSON.parse(line) as { result?: unknown }
    const { result } = message
    if (typeof result === 'object' && result !== null && 'rateLimits' in result) {
      return result as CodexRateLimitsResult
    }
  } catch {
    // not a protocol line
  }
  return null
}

// Listens beside Orca's probe and keeps the raw account/rateLimits/read answer.
export function rateLimitsResultTap(stdout: {
  on(event: 'data', listener: (chunk: Buffer) => void): unknown
}): () => CodexRateLimitsResult | null {
  let pending = ''
  let found: CodexRateLimitsResult | null = null
  stdout.on('data', (chunk) => {
    pending += chunk.toString()
    let end = pending.indexOf('\n')
    while (end !== -1) {
      found ??= rateLimitsIn(pending.slice(0, end).trim())
      pending = pending.slice(end + 1)
      end = pending.indexOf('\n')
    }
  })
  return () => found
}
