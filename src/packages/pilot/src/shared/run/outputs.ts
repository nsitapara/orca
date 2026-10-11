import type { FieldValue, ItemFields } from '../api-types'

// Output names end up in templates as steps.<step>.<name>, so they use the placeholder alphabet.
export const OUTPUT_KEY = /^[A-Za-z_][A-Za-z0-9_]{0,63}$/
export const MAX_OUTPUT_VALUE = 4096
export const OUTPUT_LINE_PREFIX = '::pilot-output '

export type OutputPair = { ok: true; key: string; value: FieldValue } | { ok: false; error: string }

// The same rule as field scripts: text that reads as a JSON scalar (true, 3, null, "x") becomes that
// value, so `{steps.review.changed} == true` holds for `changed=true`. Anything else stays text.
export function coerceOutputValue(raw: string): FieldValue {
  const text = raw.trim()
  try {
    const value: unknown = JSON.parse(text)
    if (
      value === null ||
      typeof value === 'boolean' ||
      typeof value === 'number' ||
      typeof value === 'string'
    ) {
      return value
    }
  } catch {}
  return text
}

// key=value; the value is everything after the first "=".
export function parseOutputPair(text: string): OutputPair {
  const at = text.indexOf('=')
  if (at <= 0) {
    return { ok: false, error: `"${text}" isn't key=value` }
  }
  const key = text.slice(0, at).trim()
  if (!OUTPUT_KEY.test(key)) {
    return {
      ok: false,
      error: `"${key}" isn't an output name: letters, digits and _, not starting with a digit`
    }
  }
  const raw = text.slice(at + 1)
  if (raw.length > MAX_OUTPUT_VALUE) {
    return { ok: false, error: `${key}: the value is longer than ${MAX_OUTPUT_VALUE} characters` }
  }
  return { ok: true, key, value: coerceOutputValue(raw) }
}

export function parseOutputPairs(
  pairs: readonly string[]
): { ok: true; outputs: ItemFields } | { ok: false; errors: string[] } {
  const outputs: ItemFields = {}
  const errors: string[] = []
  for (const text of pairs) {
    const pair = parseOutputPair(text)
    if (pair.ok) {
      outputs[pair.key] = pair.value
    } else {
      errors.push(pair.error)
    }
  }
  if (errors.length > 0) {
    return { ok: false, errors }
  }
  return { ok: true, outputs }
}

// `::pilot-output key=value` lines a shell step printed, one pair per line, at the start of the line.
// A bad line is a warning, never a failed step.
export function outputsFromStdout(stdout: string): { outputs: ItemFields; warnings: string[] } {
  const outputs: ItemFields = {}
  const warnings: string[] = []
  for (const line of stdout.split('\n')) {
    const text = line.replace(/\r$/, '')
    if (!text.startsWith(OUTPUT_LINE_PREFIX)) {
      continue
    }
    const pair = parseOutputPair(text.slice(OUTPUT_LINE_PREFIX.length))
    if (pair.ok) {
      outputs[pair.key] = pair.value
    } else {
      warnings.push(pair.error)
    }
  }
  return { outputs, warnings }
}
