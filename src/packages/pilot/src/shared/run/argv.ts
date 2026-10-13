// A command written as plain words and run without a shell (where.ids_from): '…' and "…" keep spaces in a word,
// and nothing is expanded, so a character a shell would act on is refused rather than passed through.
export type ArgvResult = { ok: true; argv: string[] } | { ok: false; error: string }

// Never, not even quoted: expansions, escapes and line breaks.
const NEVER = new Set(['$', '`', '\\', '\n', '\r', '\0'])
// Shell syntax outside quotes: pipes, lists, redirections, subshells, globs, tilde, comments, history.
const SHELL_SYNTAX = new Set([
  '|',
  '&',
  ';',
  '<',
  '>',
  '(',
  ')',
  '*',
  '?',
  '[',
  ']',
  '{',
  '}',
  '~',
  '#',
  '!'
])

const UNPRINTABLE: Record<string, string> = {
  '\n': 'A line break',
  '\r': 'A carriage return',
  '\0': 'A NUL byte'
}

type Quote = "'" | '"' | null

function refuse(error: string): ArgvResult {
  return { ok: false, error }
}

function quoteOf(ch: string): Quote {
  if (ch === "'" || ch === '"') {
    return ch
  }
  return null
}

export function splitArgv(command: string): ArgvResult {
  const argv: string[] = []
  let word = ''
  let inWord = false
  let quote: Quote = null
  for (const ch of command) {
    if (NEVER.has(ch)) {
      return refuse(
        `${UNPRINTABLE[ch] ?? `"${ch}"`} is never allowed: the command runs without a shell`
      )
    }
    if (quote !== null) {
      if (ch === quote) {
        quote = null
      } else {
        word += ch
      }
      continue
    }
    if (ch === ' ' || ch === '\t') {
      if (inWord) {
        argv.push(word)
      }
      word = ''
      inWord = false
      continue
    }
    if (SHELL_SYNTAX.has(ch)) {
      return refuse(
        `"${ch}" is shell syntax; ids_from runs its command without a shell (quote it, or pass a value with env:)`
      )
    }
    quote = quoteOf(ch)
    if (quote === null) {
      word += ch
    }
    inWord = true
  }
  if (quote !== null) {
    return refuse('unterminated quote')
  }
  if (inWord) {
    argv.push(word)
  }
  if (argv.length === 0) {
    return refuse('empty command')
  }
  if (argv[0].includes('=')) {
    return refuse('NAME=value before the command is shell syntax; pass it with env:')
  }
  return { ok: true, argv }
}
