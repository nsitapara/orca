import { Badge } from '@/components/ui/badge'
import type { ClearRequest, GoNowKey, QueuedRun } from '../../../shared/api-types-capacity'
import { canGoNow } from '../../../shared/capacity/go-now'
import { holdReasonText, waitedText, waitsForSlot } from '../../../shared/capacity/waiting-rows'
import { ClearButton } from './ClearButton'
import { checkOf } from './running-checks'

// 1-based place among the slot waiters, in line order; null for a held item.
export function placeInLine(queued: readonly QueuedRun[], item: QueuedRun): number | null {
  if (!waitsForSlot(item)) {
    return null
  }
  return queued.filter(waitsForSlot).indexOf(item) + 1
}

// A slot waiter's place in line, or Held and the check that holds it, as Limits & how it works names them.
function QueuedStatus({
  item,
  place
}: {
  item: QueuedRun
  place: number | null
}): React.JSX.Element {
  if (place !== null) {
    return <Badge variant="outline">#{place} in line</Badge>
  }
  const check = checkOf(item.holdCode)
  return <Badge variant="secondary">{check ? `Held · ${check.name}` : 'Held'}</Badge>
}

// Name, status, time, Go now and Clear on top; the item under it; then the reason across the whole row. Clear on a kept
// fix (job 15's items) deletes its branch, so it asks first.
export function QueuedRow({
  item,
  place,
  now,
  saving,
  onGoNow,
  onClear
}: {
  item: QueuedRun
  // Null: it waits on something other than a slot, so it has no place in the slot line.
  place: number | null
  now: number
  saving: boolean
  onGoNow(key: GoNowKey): void
  onClear(request: ClearRequest): void
}): React.JSX.Element {
  const reason = holdReasonText(item)
  return (
    <li className="flex min-w-0 flex-col gap-1 px-3 py-2 text-sm">
      <div className="flex min-w-0 items-center gap-2">
        <span className="min-w-0 truncate font-medium" title={item.automationName}>
          {item.automationName}
        </span>
        <QueuedStatus item={item} place={place} />
        {item.byHand ? <Badge variant="outline">Run now</Badge> : null}
        <span className="ml-auto shrink-0 pl-2 text-xs tabular-nums text-muted-foreground">
          {waitedText(item, now)}
        </span>
        {canGoNow(item) ? (
          <button
            type="button"
            className="shrink-0 text-xs underline disabled:opacity-50"
            disabled={saving}
            onClick={() => onGoNow({ automationId: item.automationId, itemKey: item.itemKey })}
          >
            Go now
          </button>
        ) : null}
        <ClearButton
          label={`Clear ${item.automationName}, ${item.itemLabel}`}
          confirm={item.itemKey.startsWith('kept:') ? 'Delete its kept branch?' : undefined}
          disabled={saving}
          onClear={() =>
            onClear({ kind: 'waiting', automationId: item.automationId, itemKey: item.itemKey })
          }
        />
      </div>
      <div className="truncate font-mono text-xs text-muted-foreground" title={item.itemLabel}>
        {item.itemLabel}
      </div>
      {reason ? <p className="text-xs text-muted-foreground">{reason}</p> : null}
    </li>
  )
}
