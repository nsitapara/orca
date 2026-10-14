import { z } from 'zod'
import type { StoredResult } from '../api-types-result'

export const RESULT_DATA_CAP_BYTES = 256 * 1024
export const RESULT_FIELD_CAP_BYTES = 32 * 1024
export const TEXT_OMITTED = 'may contain comment or ticket text'

// Only v, command and outcome make an envelope; the rest is read loosely. (main/envs/envelope.ts stays lenient on
// purpose: env create's exit codes back up a missing envelope there.)
const Envelope = z.looseObject({ v: z.literal(1), command: z.string(), outcome: z.string() })

export type ResultRead = {
  // What the step's row keeps, or null when its stdout isn't one envelope.
  stored: StoredResult | null
  // The envelope's reason ('' when it gave none); null without an envelope.
  reason: string | null
  // meta.text: stdout may hold comment or ticket text, so none of it is kept.
  text: boolean
}
const NONE: ResultRead = { stored: null, reason: null, text: false }

export function utf8Bytes(text: string): number {
  return new TextEncoder().encode(text).length
}

export function kbOf(bytes: number): number {
  return Math.ceil(bytes / 1024)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function envelopeIn(stdout: string): z.infer<typeof Envelope> | null {
  try {
    const parsed = Envelope.safeParse(JSON.parse(stdout.trim()))
    return parsed.success ? parsed.data : null
  } catch {
    return null
  }
}

// A shell step's whole stdout, trimmed, as one pilotcli envelope ({v: 1, command, outcome, reason, data, meta}). Data
// over 256 KB is dropped; a result marked meta.text keeps only its command, outcome and reason.
export function readStepResult(stdout: string): ResultRead {
  const envelope = envelopeIn(stdout)
  if (!envelope) {
    return NONE
  }
  const reason = typeof envelope.reason === 'string' ? envelope.reason : ''
  const head = { command: envelope.command, outcome: envelope.outcome, reason }
  const meta = isRecord(envelope.meta) ? envelope.meta : {}
  if (meta.text === true) {
    return { stored: { ...head, data_omitted: TEXT_OMITTED }, reason, text: true }
  }
  const data = envelope.data ?? null
  const size = utf8Bytes(JSON.stringify(data))
  if (size > RESULT_DATA_CAP_BYTES) {
    const stored = { ...head, meta, data_omitted: `too large (${kbOf(size)} KB)` }
    return { stored, reason, text: false }
  }
  return { stored: { ...head, data, meta }, reason, text: false }
}
