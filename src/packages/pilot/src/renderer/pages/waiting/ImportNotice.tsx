import { useCallback, useEffect, useRef, useState } from 'react'
import { pilotRpc } from '../../api'
import { IMPORT_TIMEOUT_MS, ImportVaultPanel, type ImportReport } from './ImportVaultPanel'

export function noticeText(report: ImportReport): string | null {
  const parts: string[] = []
  if ((report.imported ?? 0) > 0) {
    parts.push(`${report.imported} vault card(s) not in Pilot`)
  }
  if ((report.dates ?? 0) > 0) {
    parts.push(`Ask dates to fix for ${report.dates} imported card(s)`)
  }
  if ((report.backfilled ?? 0) > 0) {
    parts.push(`${report.backfilled} imported card(s) have Details to add from the vault`)
  }
  return parts.length > 0 ? parts.join(' · ') : null
}

// A quiet one-line notice, only while the vault import has something to do. The preview is read when the
// page mounts and after an import, never polled.
export function ImportNotice({ onImported }: { onImported: () => void }): React.JSX.Element | null {
  const [report, setReport] = useState<ImportReport | null>(null)
  const [open, setOpen] = useState(false)
  const alive = useRef(true)
  const openRef = useRef(false)
  openRef.current = open
  const preview = useCallback(async () => {
    try {
      const next = await pilotRpc<ImportReport>(
        'pilot.inbox.importVault',
        { apply: false },
        { timeoutMs: IMPORT_TIMEOUT_MS }
      )
      if (alive.current) {
        setReport(next)
      }
    } catch {
      // A failed look keeps what was last seen while the panel is open (it would unmount under the user).
      if (alive.current) {
        setReport((last) => (openRef.current ? last : null))
      }
    }
  }, [])
  useEffect(() => {
    alive.current = true
    void preview()
    return () => {
      alive.current = false
    }
  }, [preview])
  if (!report) {
    return null
  }
  if (open) {
    return (
      <ImportVaultPanel
        preview={report}
        onImported={() => {
          onImported()
          void preview()
        }}
        onClose={() => setOpen(false)}
      />
    )
  }
  const text = noticeText(report)
  if (!text) {
    return null
  }
  return (
    <div className="flex items-center gap-2.5 rounded-md border border-dashed border-border bg-card px-2.5 py-1.5 text-[12.5px] text-muted-foreground">
      <span className="flex-1">{text}</span>
      <button
        type="button"
        className="text-[var(--ib-accent)] hover:underline"
        onClick={() => setOpen(true)}
      >
        Import
      </button>
    </div>
  )
}
