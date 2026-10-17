import { ExternalLink } from 'lucide-react'
import { useState } from 'react'
import { Button } from '@/components/ui/button'
import type { ReportBlock as ReportBlockData } from '../../shared/details'
import { Section } from './blocks'

// A page read outside Pilot (job 09's review guide). Without `open` (a view that can't reach main) it shows the name only.
export function ReportBlock({
  block,
  open
}: {
  block: ReportBlockData
  open?: (file: string) => Promise<void>
}): React.JSX.Element {
  const [error, setError] = useState<string | null>(null)
  const [opening, setOpening] = useState(false)
  const click = (): void => {
    if (!open) {
      return
    }
    setOpening(true)
    setError(null)
    open(block.file).then(
      () => setOpening(false),
      (failure: unknown) => {
        setOpening(false)
        setError(failure instanceof Error ? failure.message : String(failure))
      }
    )
  }
  return (
    <Section title={block.title} cls="dt-report">
      <div className="dt-report-row">
        <span className="glr-path">{block.file.split('/').at(-1)}</span>
        {open ? (
          <Button type="button" variant="outline" size="sm" disabled={opening} onClick={click}>
            <ExternalLink className="size-3.5" />
            Open
          </Button>
        ) : null}
      </div>
      {error ? <p className="dt-error">Couldn&apos;t open it: {error}</p> : null}
    </Section>
  )
}
