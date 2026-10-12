import type { ImportCount, ImportStateResult } from '../shared/api-types'

function line(what: string, c: ImportCount, apply: boolean): string {
  const next = apply ? `added ${c.added}` : `would add ${c.total - c.present}`
  return `  ${what}: ${c.total} found, ${c.present} already in Pilot, ${next}`
}

export function formatImportState(r: ImportStateResult): string {
  const head = r.apply
    ? `Imported the old state of ${r.automationId}`
    : `Dry run for ${r.automationId}: nothing written. Add --apply to write.`
  // Seen items and sent answers only matter to the jobs that keep them, so they show only when there are some.
  const optional = (what: string, c: ImportCount): string[] =>
    c.total > 0 ? [line(what, c, r.apply)] : []
  return [
    head,
    line('handled keys', r.handled, r.apply),
    ...optional('seen items', r.seen),
    line('open sessions', r.sessions, r.apply),
    ...optional('answers already sent', r.dispatched),
    line('files', r.files, r.apply),
    ...r.plan.notes.map((n) => `  note: ${n}`)
  ].join('\n')
}
