import { readFileSync } from 'node:fs'
import { RuntimeClientError } from '../../../../cli/runtime/types'

export function invalid(message: string): RuntimeClientError {
  return new RuntimeClientError('invalid_argument', message)
}

// A flag whose value must be a JSON object ({…}); undefined when the flag wasn't given.
export function jsonObjectFlag(
  text: string | undefined,
  flag: string
): Record<string, unknown> | undefined {
  if (text === undefined) {
    return undefined
  }
  let value: unknown
  try {
    value = JSON.parse(text)
  } catch {
    throw invalid(`--${flag} isn't valid JSON`)
  }
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw invalid(`--${flag} must be a JSON object`)
  }
  return value as Record<string, unknown>
}

// A text file a flag names (--details-file), capped so a card stays a card.
export function readTextFile(path: string, flag: string, maxBytes: number): string {
  let text: string
  try {
    text = readFileSync(path, 'utf8')
  } catch (error) {
    throw invalid(`Can't read ${path}: ${(error as NodeJS.ErrnoException).code ?? String(error)}`)
  }
  if (Buffer.byteLength(text) > maxBytes) {
    throw invalid(`--${flag} ${path} is over ${Math.round(maxBytes / 1024)} KB`)
  }
  return text
}
