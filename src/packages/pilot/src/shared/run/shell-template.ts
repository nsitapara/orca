import type { ItemFields } from '../api-types'
import { shellQuote } from '../shell-quote'
import { PLACEHOLDER } from '../template'

type QuoteState = 'none' | 'single' | 'double'
export type ShellRender = { ok: true; command: string } | { ok: false; missing: string[] }

function insideSingleQuotes(value: string): string {
  return value.replace(/'/g, `'\\''`)
}

function insideDoubleQuotes(value: string): string {
  return value.replace(/[\\"$`]/g, (c) => `\\${c}`)
}

// Whether the template is inside '…' or "…" at `end`, as /bin/sh reads it (backslash escapes outside
// single quotes).
function quoteStateAt(template: string, end: number): QuoteState {
  let state: QuoteState = 'none'
  for (let i = 0; i < end; i += 1) {
    const c = template[i]
    if (state === 'single') {
      if (c === "'") {
        state = 'none'
      }
      continue
    }
    if (c === '\\') {
      i += 1
      continue
    }
    if (state === 'double') {
      if (c === '"') {
        state = 'none'
      }
      continue
    }
    if (c === "'") {
      state = 'single'
    } else if (c === '"') {
      state = 'double'
    }
  }
  return state
}

function quotedFor(state: QuoteState, value: string): string {
  if (state === 'single') {
    return insideSingleQuotes(value)
  }
  if (state === 'double') {
    return insideDoubleQuotes(value)
  }
  return shellQuote(value)
}

// Every value is quoted for where it sits, so a branch or title with spaces, quotes or $(…) stays one
// argument and never runs. A missing value fails the render: a step never runs a half-filled command.
export function renderShellCommand(template: string, fields: ItemFields): ShellRender {
  const missing = new Set<string>()
  const command = template.replace(PLACEHOLDER, (whole: string, name: string, offset: number) => {
    const value = Object.hasOwn(fields, name) ? fields[name] : undefined
    if (value === undefined || value === null) {
      missing.add(name)
      return whole
    }
    return quotedFor(quoteStateAt(template, offset), String(value))
  })
  if (missing.size > 0) {
    return { ok: false, missing: [...missing] }
  }
  return { ok: true, command }
}
