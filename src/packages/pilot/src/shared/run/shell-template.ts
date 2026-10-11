import type { ItemFields } from '../api-types'

type QuoteState = 'none' | 'single' | 'double'
export type ShellRender =
  | { ok: true; command: string; env: Record<string, string> }
  | { ok: false; missing: string[]; problems: ShellProblem[] }
export type ShellProblem = { name: string; reason: string }

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

const BOUNDARY_BEFORE = /[\s;|&()<>]/
const COMPLEX_WORDS = /(?<![\w./-])(eval|let|trap|xargs)(?![\w-])/
const SHELL_DASH_C = /(?<![\w./-])(?:ba|z|da|k)?sh\s+-\w*c\b/

// Why this command line is not a simple one: a comment, heredoc, substitution or nested shell is
// text this renderer doesn't parse, so a placeholder there could not be referenced safely.
function complexityReason(text: string): string | null {
  let state: QuoteState = 'none'
  for (let i = 0; i < text.length; i += 1) {
    const c = text[i]
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
    if (c === '`') {
      return 'a backtick command'
    }
    if (c === '$' && text[i + 1] === '(') {
      return 'a $(…) substitution'
    }
    if (c === '$' && text[i + 1] === "'" && state === 'none') {
      return "a $'…' string"
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
    } else if (c === '#' && (i === 0 || BOUNDARY_BEFORE.test(text[i - 1]))) {
      return 'a comment'
    } else if (c === '<' && text[i + 1] === '<') {
      return 'a heredoc'
    } else if ((c === '(' && text[i + 1] === '(') || (c === '[' && text[i + 1] === '[')) {
      return 'a (( )) or [[ ]] expression'
    }
  }
  if (COMPLEX_WORDS.test(text)) {
    return 'eval, let, trap or xargs'
  }
  if (SHELL_DASH_C.test(text)) {
    return 'a nested sh -c'
  }
  return null
}

// A script path that starts with ./ or ../ is single-quoted by resolveScriptCommand before rendering,
// so the check sees it the same way at load and at render.
function asRendered(template: string): string {
  const text = template.trim()
  const lead = /^(\.\.?\/\S*)/.exec(text)
  return lead ? `'${lead[1]}'${text.slice(lead[1].length)}` : text
}

// Placeholders of `template` that can't be referenced safely, with why. One check for load (the YAML's
// run:) and render (the text after resolveScriptCommand). [] when the line is fine or has none.
export function shellTemplateProblems(template: string): ShellProblem[] {
  const text = asRendered(template)
  const names = [...new Set([...text.matchAll(SHELL_PLACEHOLDER)].map((m) => m[1]))]
  if (names.length === 0) {
    return []
  }
  const reason = complexityReason(text)
  if (reason) {
    return names.map((name) => ({ name, reason: `the command has ${reason}` }))
  }
  const quoted = new Set(singleQuoted(text))
  return names
    .filter((name) => quoted.has(name))
    .map((name) => ({ name, reason: 'it is inside single quotes' }))
}

export function shellProblemMessage(p: ShellProblem): string {
  return `{${p.name}} can't be used in this command (${p.reason}); pass it as env: { NAME: '{${p.name}}' } and use "$NAME" in the script`
}

function singleQuoted(template: string): string[] {
  const names: string[] = []
  for (const m of template.matchAll(SHELL_PLACEHOLDER)) {
    if (quoteStateAt(template, m.index) === 'single') {
      names.push(m[1])
    }
  }
  return names
}

// A value never goes into the command text. Each distinct value is handed over as PILOT_ARG_<n> in the
// environment and the placeholder becomes a reference to it ("${PILOT_ARG_0}", or ${PILOT_ARG_0} inside
// "…"), so a branch or title with quotes, $(…), backticks or a newline stays data whatever surrounds it.
// A missing value, or a placeholder this renderer can't place safely (see shellTemplateProblems), fails the render: a step never runs a half-filled command.
export function renderShellCommand(template: string, fields: ItemFields): ShellRender {
  const problems = shellTemplateProblems(template)
  const missing = new Set<string>()
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
  if (missing.size > 0 || problems.length > 0) {
    return { ok: false, missing: [...missing], problems }
  }
  return { ok: true, command, env }
}
