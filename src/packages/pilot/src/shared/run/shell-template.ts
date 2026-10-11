import type { ItemFields } from '../api-types'

// Only dotted names ({mr.title}, {steps.review.changed}) are Pilot placeholders in a shell step, so
// ${HOME}, awk '{print}' and jq '{title}' are plain shell text. Global: use with replace()/matchAll().
const DOTTED_PLACEHOLDER = /\{([a-z_]\w*(?:\.\w+)+)\}/gi

// The names env: values may not take: they change how the shell or the dynamic loader behaves.
const RESERVED_ENV = new Set([
  'PATH',
  'IFS',
  'HOME',
  'ENV',
  'BASH_ENV',
  'SHELLOPTS',
  'BASHOPTS',
  'PS4',
  'CDPATH',
  'GLOBIGNORE'
])

export const RUN_PLACEHOLDER_ADVICE = `can't contain {placeholders}; pass values with env: { NAME: '{field}' } and use "$NAME" in the script`

// The Pilot placeholders written in a shell command (never allowed there; see RUN_PLACEHOLDER_ADVICE).
export function runPlaceholders(command: string): string[] {
  return [...new Set([...command.matchAll(DOTTED_PLACEHOLDER)].map((m) => m[1]))]
}

// Why `name` can't be an env: name, or null when it can.
export function envNameProblem(name: string): string | null {
  if (!/^[A-Z_][A-Z0-9_]*$/.test(name)) {
    return `${name} isn't a usable name: capital letters, digits and _, not starting with a digit`
  }
  if (/^(PILOT_|ORCA_|LD_|DYLD_)/.test(name) || RESERVED_ENV.has(name)) {
    return `${name} is reserved: not PATH, IFS, HOME, ENV, BASH_ENV, SHELLOPTS, BASHOPTS, PS4, CDPATH, GLOBIGNORE, or a name starting PILOT_, ORCA_, LD_ or DYLD_`
  }
  return null
}

export type ShellEnvRender =
  | { ok: true; env: Record<string, string> }
  | { ok: false; missing: string[] }

// Each env: value as plain text: {a.b} filled in, nothing else read. The shell never parses it, and the
// step reads it as "$NAME". A placeholder with no value fails the render.
export function renderShellEnv(
  templates: Record<string, string>,
  fields: ItemFields
): ShellEnvRender {
  const missing = new Set<string>()
  const env: Record<string, string> = {}
  for (const [name, template] of Object.entries(templates)) {
    env[name] = template.replace(DOTTED_PLACEHOLDER, (whole: string, field: string) => {
      const value = Object.hasOwn(fields, field) ? fields[field] : undefined
      if (value === undefined || value === null) {
        missing.add(field)
        return whole
      }
      return String(value)
    })
  }
  if (missing.size > 0) {
    return { ok: false, missing: [...missing] }
  }
  return { ok: true, env }
}
