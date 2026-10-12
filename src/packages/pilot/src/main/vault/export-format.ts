import type { InboxItemRow, RunRow, StepRow } from '../../shared/api-types'
import { oneLine } from '../inbox/card'

const pad = (n: number): string => String(n).padStart(2, '0')

function local(ms: number): { date: string; time: string } {
  const d = new Date(ms)
  return {
    date: `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`,
    time: `${pad(d.getHours())}:${pad(d.getMinutes())}`
  }
}

// A Runs.md line's time (vault.py stamp()).
export function stamp(ms: number): string {
  const { date, time } = local(ms)
  return `${date} ${time}`
}

// A note's created/updated frontmatter value.
export function frontStamp(ms: number): string {
  const { date, time } = local(ms)
  return `${date}T${time}`
}

export function runsHeader(link: string): string {
  return `# Runs\n\nNewest first, one line per run that did something. Job: ${link}.\n\n`
}

// vault.py _add_run_line: right after the header, else above the first line, else at the end.
export function insertRunsLine(content: string, header: string, line: string): string {
  const at = content.indexOf(header)
  if (at !== -1) {
    const cut = at + header.length
    return content.slice(0, cut) + line + content.slice(cut)
  }
  const first = /^- /m.exec(content)
  if (first) {
    return content.slice(0, first.index) + line + content.slice(first.index)
  }
  const gap = content === '' || content.endsWith('\n') ? '' : '\n'
  return content + gap + line
}

// Every vault note carries created/updated (local time); `updated` moves on each write (vault.touch_note).
export function touchFrontmatter(content: string, at: number, automation: string): string {
  const now = frontStamp(at)
  if (!content.startsWith('---\n')) {
    return `---\ncreated: ${now}\nupdated: ${now}\nautomation: ${automation}\n---\n\n${content}`
  }
  const end = content.indexOf('\n---\n', 4)
  if (end === -1) {
    return content
  }
  const lines = content.slice(4, end).split('\n')
  const index = lines.findIndex((l) => l.startsWith('updated:'))
  if (index !== -1) {
    lines[index] = `updated: ${now}`
  } else {
    lines.push(`updated: ${now}`)
  }
  return `---\n${lines.join('\n')}${content.slice(end)}`
}

const ENDED: Record<string, string> = {
  done: 'done',
  failed: 'failed',
  timed_out: 'timed out',
  needs_you: 'needs you'
}

// The line a run's last summary output gave (the shim's `pilot run output summary=…`), else how it ended.
export function runSummary(run: RunRow, steps: StepRow[]): string {
  const summary = steps
    .toReversed()
    .map((s) => s.outputs.summary)
    .find((v): v is string => typeof v === 'string' && v !== '')
  if (summary) {
    return oneLine(summary)
  }
  const outcome = run.outcome ? `: ${run.outcome}` : ''
  // The whole line: the item label is agent-influenced too, and a newline would start another line.
  return oneLine(`${run.itemLabel} · ${ENDED[run.status] ?? run.status}${outcome} · run ${run.id}`)
}

const begin = (id: string): string => `<!-- pilot:inbox:begin ${id} -->`
const end = (id: string): string => `<!-- pilot:inbox:end ${id} -->`

function stateWords(item: InboxItemRow): string {
  if (item.status === 'open') {
    return 'waiting on you'
  }
  if (item.status === 'answered') {
    return 'answered, not applied yet'
  }
  return `✓ ${field(item.outcome) || item.status}`
}

// One line, never starting like a vault checkbox item ("- [ ]"), and with no HTML comment opener (it renders as
// "<!--" but can't forge or hide a block marker): these fields come from agents and people.
function field(text: string | null | undefined): string {
  return oneLine(text)
    .replace(/^-\s*\[/, '- (')
    .replaceAll('<!--', '<\\!--')
}

// No checkbox on purpose: vault.py's ITEM pattern needs "- [ ]", so no vault reader takes these as items.
function itemLines(item: InboxItemRow, location: string): string[] {
  const lines = [
    `- **${field(item.type)}** · ${field(item.title)} — \`${field(location)}\` · ${stateWords(item)}`
  ]
  const context = [
    field(item.context),
    item.suggested ? `Suggested: ${field(item.suggested)}` : ''
  ].filter(Boolean)
  if (context.length) {
    lines.push(`  ${context.join(' ')}`)
  }
  if (item.options.length) {
    lines.push(
      `  Options: ${item.options.map((o) => field([o.label, o.meaning].filter(Boolean).join(' — '))).join(' | ')}`
    )
  }
  if (item.answer) {
    const said = item.answer.text ?? item.options[item.answer.option ?? -1]?.label ?? ''
    lines.push(`  Answer: ${field(said)}`)
  }
  for (const reply of item.replies) {
    const who = reply.by === 'pilot' ? 'Pilot' : 'Reply'
    lines.push(`  ${who}: ${field(reply.text)}`)
  }
  return lines
}

export function itemsBlock(
  automationId: string,
  items: InboxItemRow[],
  locationOf: (item: InboxItemRow) => string,
  at: number
): string {
  return [
    begin(automationId),
    `## Waiting on you in Pilot · ${stamp(at)}`,
    "Read-only: answer on Pilot's Waiting on you page. Pilot rewrites this section after every change.",
    '',
    ...items.flatMap((i) => itemLines(i, locationOf(i))),
    end(automationId),
    ''
  ].join('\n')
}

// True when this automation's markers can't be paired (a begin with no end, an end with no begin, or the
// end first): the block can't be found, so nothing in the note may be spliced.
export function hasBrokenMarkers(content: string, automationId: string): boolean {
  const from = content.indexOf(begin(automationId))
  const to = content.indexOf(end(automationId))
  return (from === -1) !== (to === -1) || (from !== -1 && to < from)
}

export function hasMarkers(content: string, automationId: string): boolean {
  return content.includes(begin(automationId))
}

// Replace this automation's block, append it, or (block null) remove it. Nothing else in the note moves.
export function replaceBlock(content: string, automationId: string, block: string | null): string {
  const from = content.indexOf(begin(automationId))
  const to = content.indexOf(end(automationId))
  if (hasBrokenMarkers(content, automationId)) {
    return content
  }
  if (from === -1 || to === -1) {
    if (block === null) {
      return content
    }
    return `${content}${content.endsWith('\n') ? '' : '\n'}\n${block}`
  }
  const after = content.slice(to + end(automationId).length).replace(/^\n/, '')
  if (block === null) {
    return content.slice(0, from).replace(/\n\n$/, '\n') + after
  }
  return content.slice(0, from) + block + after
}
