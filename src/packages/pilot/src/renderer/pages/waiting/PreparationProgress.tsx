import type { PreparationRequirement } from '../../../shared/preparation'
import type { InboxItemRow } from '../../../shared/api-types'

const ARTIFACT_LABELS: Record<PreparationRequirement, string> = {
  context: 'decision context',
  diff: 'code diff',
  screens: 'before / after screenshots',
  checks: 'verification results',
  review: 'exact review comments'
}

export function PreparationProgress({ item }: { item: InboxItemRow }): React.JSX.Element | null {
  const preparation = item.preparation
  if (!preparation) {
    return null
  }
  if (preparation.state === 'cancelled') {
    return (
      <p className="text-xs text-muted-foreground">
        Context preparation stopped after your answer.
      </p>
    )
  }
  if (preparation.state === 'ready') {
    return null
  }
  return (
    <div role="status" className="flex flex-col gap-1 text-sm text-muted-foreground">
      {preparation.progress ? <p>{preparation.progress}</p> : null}
      <p>
        Needed for your decision:{' '}
        {preparation.input.requirements.map((kind) => ARTIFACT_LABELS[kind]).join(', ')}.
      </p>
      {preparation.error ? <p className="text-destructive">{preparation.error}</p> : null}
      <p>
        You can answer now to stop preparation. Generated changes can be approved once their context
        is ready.
      </p>
    </div>
  )
}
