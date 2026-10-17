import type { InboxItemRow } from '../../shared/api-types'
import type { RunLine } from '../../shared/inbox-types'
import { approvedArgs } from '../actions/powers'
import type { ActionCatalog } from '../actions/types'
import { routeOf } from '../answers/queue-view'

// An action card's Run line: what its Approve runs, written by Pilot from the stored card version the
// digest binds, never from the agent's words. The args are powers.ts approvedArgs (what cardToRun runs: the
// parts left out applied, the write id pinned), and a pilotcli entry's line is its command() for this card, built
// by the code its run() spawns with. The text is printable ASCII only: anything else (bidi controls, zero-width
// and other invisible or control characters, lookalike letters) shows as an escape, never raw.

const SAFE_WORD = /^[A-Za-z0-9_@%+=:,./-]+$/
const PRINTABLE = /^[\x20-\x7e]*$/
const NOT_PRINTABLE = /[^\x20-\x7e]/g

function hex(n: number, width: number): string {
  return n.toString(16).toUpperCase().padStart(width, '0')
}

// One character inside bash's $'…' (ANSI-C quoting), which reads these escapes back to the same text.
function ansiC(ch: string): string {
  if (ch === '\\' || ch === "'") {
    return `\\${ch}`
  }
  if (ch === '\n') {
    return '\\n'
  }
  if (ch === '\t') {
    return '\\t'
  }
  if (PRINTABLE.test(ch)) {
    return ch
  }
  const point = ch.codePointAt(0) ?? 0
  return point > 0xffff ? `\\U${hex(point, 8)}` : `\\u${hex(point, 4)}`
}

// A word as a shell reads it back exactly: bare when safe, single-quoted when printable, else $'…'.
export function shellWord(word: string): string {
  if (SAFE_WORD.test(word)) {
    return word
  }
  if (PRINTABLE.test(word)) {
    return `'${word.replaceAll("'", "'\\''")}'`
  }
  return `$'${[...word].map(ansiC).join('')}'`
}

// Every character outside printable ASCII as a \uXXXX escape (per UTF-16 unit, as JSON reads it).
function visible(text: string): string {
  return text.replace(NOT_PRINTABLE, (c) => `\\u${hex(c.charCodeAt(0), 4)}`)
}

// JSON that parses back to the same value, in printable ASCII.
function asciiJson(value: unknown): string {
  return visible(JSON.stringify(value))
}

// The parts a saved approval leaves out ("approve except: …"); none before it is answered.
function leftOutOf(catalog: ActionCatalog, card: InboxItemRow): string[] {
  const route = routeOf(card, catalog)
  return route.kind === 'script' ? route.leaveOut : []
}

function cantRun(card: InboxItemRow, why: string): RunLine {
  return { digest: card.digest, text: `Approve can't run: ${visible(why)}` }
}

export function cardRunLine(catalog: ActionCatalog, card: InboxItemRow): RunLine | null {
  if (!card.action) {
    return null
  }
  const entry = catalog.get(card.action)
  if (!entry) {
    return cantRun(card, `no action "${card.action}" in Pilot's catalog`)
  }
  const bad = entry.checkArgs(card.actionArgs ?? {})
  if (bad) {
    return cantRun(card, bad)
  }
  const approved = approvedArgs(entry, card, leftOutOf(catalog, card))
  if ('problem' in approved) {
    return cantRun(card, approved.problem)
  }
  const command =
    entry.command?.(approved.args, { runId: card.runId, inboxItemId: card.id }) ?? null
  const text = command
    ? command.map(shellWord).join(' ')
    : `${entry.name} ${asciiJson(approved.args)}`
  return { digest: card.digest, text }
}
