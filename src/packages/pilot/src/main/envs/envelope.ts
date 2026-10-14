import { lastLine } from '../last-line'
import { formatDuration } from '../../shared/run/format-duration'

export type PilotcliOutcome = 'ok' | 'failed' | 'invalid' | 'skip' | 'not_yet'
export type PilotcliReply = {
  outcome: PilotcliOutcome
  reason: string
  data: unknown
  code: number | null
}
type Ran = {
  code: number | null
  signal: string | null
  stdout: string
  stderr: string
  timedOut: boolean
}

const OUTCOMES: ReadonlySet<string> = new Set(['ok', 'failed', 'invalid', 'skip', 'not_yet'])
// The exit codes back the envelope up (M4 §8): ok 0, failed 1, invalid 2, skip 3, not_yet 5.
const BY_CODE: Record<number, PilotcliOutcome> = {
  0: 'ok',
  1: 'failed',
  2: 'invalid',
  3: 'skip',
  5: 'not_yet'
}

function envelopeOf(stdout: string): Omit<PilotcliReply, 'code'> | null {
  try {
    const value = JSON.parse(stdout.trim()) as {
      outcome?: unknown
      reason?: unknown
      data?: unknown
    } | null
    if (value && typeof value.outcome === 'string' && OUTCOMES.has(value.outcome)) {
      const reason = typeof value.reason === 'string' ? value.reason : ''
      return { outcome: value.outcome as PilotcliOutcome, reason, data: value.data ?? null }
    }
  } catch {
    // not an envelope: the exit code decides
  }
  return null
}

function exitWords(ran: Ran): string {
  if (ran.code === null) {
    return `stopped by ${ran.signal ?? 'a signal'}`
  }
  return `exited ${ran.code}`
}

// The envelope's outcome when stdout holds one, else the exit code's; anything else is failed with what it said last.
export function readReply(ran: Ran, what: string, timeoutMs: number): PilotcliReply {
  if (ran.timedOut) {
    return {
      outcome: 'failed',
      reason: `pilotcli ${what} timed out after ${formatDuration(timeoutMs)}`,
      data: null,
      code: ran.code
    }
  }
  const said = lastLine(ran.stderr)
  const envelope = envelopeOf(ran.stdout)
  if (envelope) {
    return { ...envelope, reason: envelope.reason || said, code: ran.code }
  }
  const byCode = ran.code === null ? undefined : BY_CODE[ran.code]
  if (byCode) {
    return { outcome: byCode, reason: said, data: null, code: ran.code }
  }
  const tail = said ? `: ${said}` : ''
  return {
    outcome: 'failed',
    reason: `pilotcli ${what} ${exitWords(ran)}${tail}`,
    data: null,
    code: ran.code
  }
}
