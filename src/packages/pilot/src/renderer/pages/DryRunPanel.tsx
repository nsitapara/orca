import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import type { TickOutcome } from '../../shared/api-types'
import { workspacePreviewLines } from '../../shared/env-text'
import { handoverPreviewLines } from '../../shared/handover-text'
import { CheckTable } from './CheckTable'
import { checkedItems, dryRunLine, outcomeLine } from './format'

// What a dry run says a tick would do: which items it would pick up and what each would get, what it would hand on,
// where an env run would work. Shown where it was asked and stored nowhere, so it is gone once closed.
// `tag`: on a job's page, the stage. `nameOf` names a receiving stage.
export function DryRunPanel({
  id,
  outcome,
  checkNames,
  tag,
  nameOf,
  onClose
}: {
  id: string
  outcome: TickOutcome
  checkNames: string[]
  tag?: string
  nameOf?: (automationId: string) => string
  onClose?: () => void
}): React.JSX.Element {
  const decided = outcome.status === 'ok' || outcome.status === 'failed'
  const summary = outcome.status === 'ok' ? dryRunLine(outcome.decisions) : outcomeLine(outcome, id)
  const checked = decided ? checkedItems(outcome.decisions) : []
  const handover =
    decided && outcome.handover ? handoverPreviewLines(outcome.handover, true, nameOf) : []
  const lines = [
    ...(decided ? (outcome.warnings ?? []) : []),
    ...handover,
    ...workspacePreviewLines(outcome)
  ]
  return (
    <section className="rounded-md border border-border/50 p-3">
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        <Badge variant="secondary">Dry run</Badge>
        {tag ? <Badge variant="outline">{tag}</Badge> : null}
        <span>Nothing was started or saved.</span>
        <span className="flex-1" />
        {onClose ? (
          <Button variant="ghost" size="sm" onClick={onClose}>
            Close
          </Button>
        ) : null}
      </div>
      <div className="mt-1 text-sm">{summary}</div>
      {lines.map((line) => (
        <div key={line} className="text-xs text-muted-foreground">
          {line}
        </div>
      ))}
      {checked.length ? <CheckTable items={checked} checkNames={checkNames} dryRun /> : null}
    </section>
  )
}
