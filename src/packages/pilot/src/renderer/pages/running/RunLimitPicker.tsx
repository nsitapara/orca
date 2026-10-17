import { Minus, Plus } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { MAX_RUN_LIMIT } from '../../../shared/capacity/limit-suggestion'

// One line, 1…MAX_RUN_LIMIT then no limit: + past the top is no limit, − from no limit is the top.
function stepDown(limit: number | null): number | null {
  return limit === null ? MAX_RUN_LIMIT : Math.max(limit - 1, 1)
}

function stepUp(limit: number | null): number | null {
  return limit === null || limit >= MAX_RUN_LIMIT ? null : limit + 1
}

export function RunLimitPicker({
  limit,
  disabled,
  onChange
}: {
  limit: number | null
  disabled: boolean
  onChange(limit: number | null): void
}): React.JSX.Element {
  return (
    <div className="flex items-center gap-2">
      <Button
        variant="outline"
        size="icon-sm"
        aria-label="Fewer jobs at once"
        disabled={disabled || limit === 1}
        onClick={() => onChange(stepDown(limit))}
      >
        <Minus className="size-3" />
      </Button>
      <output
        aria-label="Jobs at once"
        aria-live="polite"
        className="w-16 text-center text-sm font-medium tabular-nums"
      >
        {limit ?? 'No limit'}
      </output>
      <Button
        variant="outline"
        size="icon-sm"
        aria-label="More jobs at once"
        disabled={disabled || limit === null}
        onClick={() => onChange(stepUp(limit))}
      >
        <Plus className="size-3" />
      </Button>
    </div>
  )
}
