import type { EffectKind } from '../../shared/visibility-types'

export type CommandEffect = { kind: EffectKind; target: string | null }

const HEREDOC = /<<-?\s*(['"]?)([A-Za-z_][A-Za-z0-9_]*)\1/
const PREFIXES = new Set(['rtk', 'proxy', 'env', 'command', 'time', 'nohup'])
const ASSIGNMENT = /^[A-Za-z_][A-Za-z0-9_]*=/
const REDIRECT = /^\d*[<>]/
const HELP = new Set(['--help', '-h'])
const PUSH_SKIP = new Set(['--dry-run', '-n'])
const TICKET = /^[A-Z][A-Z0-9]{1,9}-\d+$/
const MR = /^!?(\d+)$/
const WRITE_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE'])
const FIELD_FLAGS = new Set(['-f', '--field', '-F', '--raw-field'])
const VALUE_FLAGS = new Set([
  '-X',
  '--method',
  '-H',
  '--header',
  '--hostname',
  '--input',
  '-R',
  '--repo',
  ...FIELD_FLAGS
])
const SEPARATORS = new Set(['\n', ';', '|', '&'])

// Removes each heredoc's body (the lines up to its end word), so text piped into a command is never read as commands.
export function dropHeredocs(command: string): string {
  const out: string[] = []
  let end: string | null = null
  for (const line of command.split('\n')) {
    if (end !== null) {
      if (line.trim() === end) {
        end = null
      }
      continue
    }
    out.push(line)
    end = HEREDOC.exec(line)?.[2] ?? null
  }
  return out.join('\n')
}

// Reads a quoted string starting at `i`: its text and the index of its closing quote.
function quoted(command: string, i: number): { text: string; end: number } {
  const quote = command[i]
  let text = ''
  let j = i + 1
  while (j < command.length && command[j] !== quote) {
    if (quote === '"' && command[j] === '\\' && j + 1 < command.length) {
      j += 1
    }
    text += command[j]
    j += 1
  }
  return { text, end: j }
}

// Splits a shell command into simple commands (at unquoted &&, ||, ;, | and newlines), each a list of words with their
// quotes removed. A quoted string stays one word, so a message that mentions a command is never read as one.
export function segments(command: string): string[][] {
  const out: string[][] = []
  let words: string[] = []
  let word = ''
  let has = false
  const endWord = (): void => {
    if (has) {
      words.push(word)
    }
    word = ''
    has = false
  }
  const endSegment = (): void => {
    endWord()
    if (words.length > 0) {
      out.push(words)
    }
    words = []
  }
  for (let i = 0; i < command.length; i++) {
    const c = command[i]
    if (c === "'" || c === '"') {
      const q = quoted(command, i)
      word += q.text
      has = true
      i = q.end
    } else if (c === '\\' && i + 1 < command.length) {
      word += command[i + 1]
      has = true
      i += 1
    } else if (SEPARATORS.has(c)) {
      endSegment()
    } else if (c === ' ' || c === '\t') {
      endWord()
    } else {
      word += c
      has = true
    }
  }
  endSegment()
  return out
}

// The command's own words: leading wrappers (rtk, env, VAR=value) and redirections dropped, the tool by its base name.
function commandWords(words: readonly string[]): string[] {
  let i = 0
  while (i < words.length && (PREFIXES.has(words[i]) || ASSIGNMENT.test(words[i]))) {
    i += 1
  }
  const rest = words.slice(i).filter((w) => !REDIRECT.test(w))
  if (rest.length > 0) {
    rest[0] = rest[0].split('/').pop() ?? rest[0]
  }
  return rest
}

function plainArgs(words: readonly string[]): string[] {
  return words.filter((w) => !w.startsWith('-'))
}

function mrOf(words: readonly string[]): string | null {
  const found = words.map((w) => MR.exec(w)?.[1]).find((n) => n !== undefined)
  return found === undefined ? null : `!${found}`
}

function branchOf(ref: string | undefined): string | null {
  if (!ref) {
    return null
  }
  const name = (ref.replace(/^\+/, '').split(':').pop() ?? '').replace(/^refs\/heads\//, '')
  return name && name !== 'HEAD' ? name : null
}

function gitEffect(w: readonly string[]): CommandEffect[] {
  let i = 1
  while (i < w.length && w[i].startsWith('-')) {
    i += w[i] === '-C' || w[i] === '-c' ? 2 : 1
  }
  const args = w.slice(i + 1)
  if (w[i] !== 'push' || args.some((a) => PUSH_SKIP.has(a))) {
    return []
  }
  return [{ kind: 'pushed', target: branchOf(plainArgs(args)[1]) }]
}

function pilotcliEffect(w: readonly string[]): CommandEffect[] {
  const plain = plainArgs(w.slice(3)).filter((a) => !a.includes('='))
  if (w[1] === 'git' && w[2] === 'push-branch') {
    return [{ kind: 'pushed', target: plain[0] ?? null }]
  }
  if (w[1] === 'gitlab' && w[2] === 'reply-thread') {
    return [{ kind: 'mr_commented', target: mrOf(plain) }]
  }
  return []
}

function apiMethod(w: readonly string[]): string | null {
  for (let i = 2; i < w.length; i++) {
    if (w[i] === '-X' || w[i] === '--method') {
      return (w[i + 1] ?? '').toUpperCase()
    }
    const inline = /^(?:-X|--method=)([A-Za-z]+)$/.exec(w[i])
    if (inline) {
      return inline[1].toUpperCase()
    }
  }
  // glab api sends a POST when fields are given and no method is named.
  return w.some((x) => FIELD_FLAGS.has(x)) ? 'POST' : null
}

function apiPath(w: readonly string[]): string | null {
  for (let i = 2; i < w.length; i++) {
    if (!w[i].startsWith('-')) {
      return w[i]
    }
    if (VALUE_FLAGS.has(w[i])) {
      i += 1
    }
  }
  return null
}

function glabEffect(w: readonly string[]): CommandEffect[] {
  if (w[1] === 'api') {
    const method = apiMethod(w)
    return method && WRITE_METHODS.has(method) ? [{ kind: 'gitlab_write', target: apiPath(w) }] : []
  }
  if (w[1] !== 'mr') {
    return []
  }
  const plain = plainArgs(w.slice(3))
  if (w[2] === 'create') {
    return [{ kind: 'mr_opened', target: null }]
  }
  if (w[2] === 'update' || w[2] === 'merge') {
    return [{ kind: 'mr_updated', target: mrOf(plain) ?? plain[0] ?? null }]
  }
  return w[2] === 'note' ? [{ kind: 'mr_commented', target: mrOf(plain) }] : []
}

function orcaEffect(w: readonly string[]): CommandEffect[] {
  if (w[1] !== 'linear') {
    return []
  }
  const ticket = w.find((x) => TICKET.test(x)) ?? null
  if (w[2] === 'create') {
    return [{ kind: 'ticket_created', target: null }]
  }
  if (w[2] === 'comment' && (w[3] === 'add' || w[3] === 'edit')) {
    return [{ kind: 'ticket_commented', target: ticket }]
  }
  return w[2] === 'issue' && w[3] === 'update' ? [{ kind: 'ticket_updated', target: ticket }] : []
}

const BY_TOOL: Record<string, (w: readonly string[]) => CommandEffect[]> = {
  git: gitEffect,
  pilotcli: pilotcliEffect,
  glab: glabEffect,
  orca: orcaEffect
}

// What a Bash command changed outside Pilot (spec §2 Known outside commands): one effect per matching simple command.
export function commandEffects(command: string): CommandEffect[] {
  return segments(dropHeredocs(command)).flatMap((raw) => {
    const w = commandWords(raw)
    const read = BY_TOOL[w[0] ?? '']
    if (!read || w.some((x) => HELP.has(x))) {
      return []
    }
    return read(w)
  })
}
