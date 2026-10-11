import type { ItemFields } from '../api-types'

type QuoteState = 'none' | 'single' | 'double'
export type ShellRender =
  | { ok: true; command: string; env: Record<string, string> }
  | { ok: false; missing: string[]; inSingleQuotes: string[] }

export const ARG_ENV_PREFIX = 'PILOT_ARG_'

// A placeholder as the shell template reads it: the usual {name}, but a "{" right after "$" or "\" is
// the shell's own (${HOME}, \{), so it stays literal. Global: use with replace()/matchAll().
const SHELL_PLACEHOLDER = /(?<![$\\])\{([a-z_]\w*(?:\.\w+)+|[a-z_]\w*)\}/gi

// Whether the template is inside '…' or "…" at `end`, as /bin/sh reads the plain cases (backslash
// escapes outside single quotes). It is only a guide for choosing how to write the reference: a value
// never enters the command text, so a wrong guess can split a word but can never run anything.
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

// Names of placeholders written inside '…': nothing expands there, so they can't carry a value.
export function singleQuotedPlaceholders(template: string): string[] {
  const names = new Set<string>()
  for (const m of template.matchAll(SHELL_PLACEHOLDER)) {
    if (quoteStateAt(template, m.index) === 'single') {
      names.add(m[1])
    }
  }
  return [...names]
}

// A value never goes into the command text. Each distinct value is handed over as PILOT_ARG_<n> in the
// environment and the placeholder becomes a reference to it ("${PILOT_ARG_0}", or ${PILOT_ARG_0} inside
// "…"), so a branch or title with quotes, $(…), backticks or a newline stays data whatever surrounds it.
// A missing value, or a placeholder inside '…', fails the render: a step never runs a half-filled command.
export function renderShellCommand(template: string, fields: ItemFields): ShellRender {
  const missing = new Set<string>()
  const inSingleQuotes = new Set<string>()
  const env: Record<string, string> = {}
  const slots = new Map<string, string>()
  const command = template.replace(
    SHELL_PLACEHOLDER,
    (whole: string, name: string, offset: number) => {
      const value = Object.hasOwn(fields, name) ? fields[name] : undefined
      if (value === undefined || value === null) {
        missing.add(name)
        return whole
      }
      const state = quoteStateAt(template, offset)
      if (state === 'single') {
        inSingleQuotes.add(name)
        return whole
      }
      const text = String(value)
      let slot = slots.get(text)
      if (slot === undefined) {
        slot = `${ARG_ENV_PREFIX}${slots.size}`
        slots.set(text, slot)
        env[slot] = text
      }
      return state === 'double' ? `\${${slot}}` : `"\${${slot}}"`
    }
  )
  if (missing.size > 0 || inSingleQuotes.size > 0) {
    return { ok: false, missing: [...missing], inSingleQuotes: [...inSingleQuotes] }
  }
  return { ok: true, command, env }
}
