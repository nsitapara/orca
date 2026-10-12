import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { pilotRpc } from '../../api'
import { errorText } from '../format'

// The export asks GitLab for each branch's MR.
export const IMPORT_TIMEOUT_MS = 180_000

export type ImportReport = {
  applied: boolean
  imported: number
  answers: number
  runs: number
  // Cards already imported that get (or would get) their Details bundle.
  backfilled?: number
  // Imported open cards that get (or would get) the vault's ask date.
  dates?: number
  skipped: { summary: string; reason: string }[]
}

function detailsPart(report: ImportReport): string {
  const n = report.backfilled ?? 0
  if (n === 0) {
    return ''
  }
  const verb = report.applied ? 'added' : 'would add'
  return `; ${verb} Details for ${n} card(s) already imported`
}

function datesPart(report: ImportReport): string {
  const n = report.dates ?? 0
  if (n === 0) {
    return ''
  }
  return `; ${report.applied ? 'fixed' : 'would fix'} the ask date of ${n} card(s) already imported`
}

function summaryOf(report: ImportReport): string {
  const verb = report.applied ? 'Imported' : 'Would import'
  const skipped = report.skipped.length
  return `${verb} ${report.imported} card(s), ${report.answers} with an answer; ${skipped} skipped${detailsPart(report)}${datesPart(report)}.`
}

// The import's preview and its Apply. Applying is the desktop's alone (the server checks), so this page is
// the only place that can do it.
export function ImportVaultPanel({
  preview,
  onImported,
  onClose
}: {
  preview: ImportReport
  onImported: () => void
  onClose: () => void
}): React.JSX.Element {
  const [busy, setBusy] = useState(false)
  const [report, setReport] = useState<ImportReport>(preview)
  const [error, setError] = useState<string | null>(null)
  const apply = async () => {
    setBusy(true)
    setError(null)
    try {
      setReport(
        await pilotRpc<ImportReport>(
          'pilot.inbox.importVault',
          { apply: true },
          { timeoutMs: IMPORT_TIMEOUT_MS }
        )
      )
      onImported()
    } catch (e) {
      setError(errorText(e))
    }
    setBusy(false)
  }
  const canApply =
    !report.applied &&
    (report.imported > 0 || (report.backfilled ?? 0) > 0 || (report.dates ?? 0) > 0)
  return (
    <section className="flex flex-wrap items-center gap-2 rounded-md border border-dashed border-border px-2.5 py-1.5 text-sm">
      <span className="text-muted-foreground">{summaryOf(report)}</span>
      {canApply ? (
        <Button size="xs" disabled={busy} onClick={() => void apply()}>
          Apply import
        </Button>
      ) : null}
      <Button size="xs" variant="ghost" onClick={onClose}>
        Close
      </Button>
      {report.skipped.map((s) => (
        <span key={s.summary + s.reason} className="w-full text-xs text-muted-foreground">
          Skipped “{s.summary}”: {s.reason}
        </span>
      ))}
      {error ? <span className="text-destructive">{error}</span> : null}
    </section>
  )
}
