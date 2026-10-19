import { Button } from '@/components/ui/button'
import type { GaveUpKey, RetryKey } from '../../../shared/api-types-capacity'
import { failedTimesText } from '../../../shared/capacity/waiting-rows'

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
