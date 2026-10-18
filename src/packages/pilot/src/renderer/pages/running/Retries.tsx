import { Button } from '@/components/ui/button'
import type { CapacityPayload, GaveUpKey, RetryKey } from '../../../shared/api-types-capacity'
import { RetryLimitPicker } from './LimitPickers'
import { failedTimesText, retryText } from './running-text'

// Older Pilots send no retry limit, so they show no stepper.
export function RetryPanel({
  payload,
  saving,
  onChange
}: {
  payload: CapacityPayload
  saving: boolean
  onChange(limit: number): void
}): React.JSX.Element | null {
  if (payload.retryLimit === undefined) {
    return null
  }
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-2 border-t border-border/50 pt-3">
      <div className="min-w-0 flex-1">
        <div className="text-sm font-medium">Retries after a failure</div>
        <p className="text-xs text-muted-foreground">{retryText()}</p>
      </div>
      <RetryLimitPicker limit={payload.retryLimit} disabled={saving} onChange={onChange} />
    </div>
  )
}

// A key the runner stopped retrying: Retry frees it and runs its job by hand.
export function GaveUpRow({
  item,
  saving,
  onRetry
}: {
  item: GaveUpKey
  saving: boolean
  onRetry(key: RetryKey): void
}): React.JSX.Element {
  return (
    <li className="flex min-w-0 items-center gap-2 px-3 py-2 text-sm">
      <span className="shrink-0 font-medium">{item.automationName}</span>
      <div className="min-w-0 flex-1">
        <div className="truncate font-mono text-xs text-muted-foreground" title={item.itemLabel}>
          {item.itemLabel}
        </div>
        {item.outcome ? (
          <div className="truncate text-xs text-muted-foreground" title={item.outcome}>
            {item.outcome}
          </div>
        ) : null}
      </div>
      <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
        {failedTimesText(item.failures)}
      </span>
      <Button
        variant="outline"
        size="xs"
        disabled={saving}
        onClick={() => onRetry({ automationId: item.automationId, onceKey: item.onceKey })}
      >
        Retry
      </Button>
    </li>
  )
}
