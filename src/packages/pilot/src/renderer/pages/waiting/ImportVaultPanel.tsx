import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { pilotRpc } from '../../api'
import { errorText } from '../format'

// The export asks GitLab for each branch's MR.
const IMPORT_TIMEOUT_MS = 180_000

type Report = {
  applied: boolean
  imported: number
  answers: number
  runs: number
  skipped: { summary: string; reason: string }[]
}

function summaryOf(report: Report): string {
  const verb = report.applied ? 'Imported' : 'Would import'
  const skipped = report.skipped.length
  return `${verb} ${report.imported} card(s), ${report.answers} with an answer; ${skipped} skipped.`
}

// A one-shot move of the vault's open cards into Pilot: preview first, then apply. Applying is the
// desktop's alone (the server checks), so this page is the only place that can do it.
export function ImportVaultPanel({ onImported }: { onImported: () => void }): React.JSX.Element {
  const [busy, setBusy] = useState(false)
  const [report, setReport] = useState<Report | null>(null)
  const [error, setError] = useState<string | null>(null)
  const run = async (apply: boolean) => {
    setBusy(true)
    setError(null)
    try {
      const next = await pilotRpc<Report>(
        'pilot.inbox.importVault',
        { apply },
        { timeoutMs: IMPORT_TIMEOUT_MS }
      )
      setReport(next)
      if (apply) {
        onImported()
      }
    } catch (e) {
      setError(errorText(e))
    }
    setBusy(false)
  }
  const canApply = report !== null && !report.applied && report.imported > 0
  return (
    <section className="flex flex-wrap items-center gap-2 text-sm">
      <Button size="xs" variant="outline" disabled={busy} onClick={() => void run(false)}>
        Import open vault cards
      </Button>
      {report ? <span className="text-muted-foreground">{summaryOf(report)}</span> : null}
      {canApply ? (
        <Button size="xs" disabled={busy} onClick={() => void run(true)}>
          Apply import
        </Button>
      ) : null}
      {report?.skipped.map((s) => (
        <span key={s.summary + s.reason} className="w-full text-xs text-muted-foreground">
          Skipped “{s.summary}”: {s.reason}
        </span>
      ))}
      {error ? <span className="text-destructive">{error}</span> : null}
    </section>
  )
}
