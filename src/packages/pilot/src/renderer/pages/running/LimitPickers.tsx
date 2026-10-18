import { Minus, Plus } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { MAX_RUN_LIMIT } from '../../../shared/capacity/limit-suggestion'
import { MAX_RETRY_LIMIT } from '../../../shared/capacity/retry-limit'

// Where − or + goes; disabled at that end.
type Step<T> = { label: string; to: T; disabled: boolean }

// − value +: the Running page's limits.
function LimitStepper<T>({
  name,
  shown,
  fewer,
  more,
  disabled,
  onChange
}: {
  name: string
  shown: string
  fewer: Step<T>
  more: Step<T>
  disabled: boolean
  onChange(value: T): void
}): React.JSX.Element {
  return (
    <div className="flex items-center gap-2">
      <Button
        variant="outline"
        size="icon-sm"
        aria-label={fewer.label}
        disabled={disabled || fewer.disabled}
        onClick={() => onChange(fewer.to)}
      >
        <Minus className="size-3" />
      </Button>
      <output
        aria-label={name}
        aria-live="polite"
        className="w-16 text-center text-sm font-medium tabular-nums"
      >
        {shown}
      </output>
      <Button
        variant="outline"
        size="icon-sm"
        aria-label={more.label}
        disabled={disabled || more.disabled}
        onClick={() => onChange(more.to)}
      >
        <Plus className="size-3" />
      </Button>
    </div>
  )
}

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
    <LimitStepper
      name="Jobs at once"
      shown={limit === null ? 'No limit' : String(limit)}
      fewer={{ label: 'Fewer jobs at once', to: stepDown(limit), disabled: limit === 1 }}
      more={{ label: 'More jobs at once', to: stepUp(limit), disabled: limit === null }}
      disabled={disabled}
      onChange={onChange}
    />
  )
}

// 0…MAX_RETRY_LIMIT: 0 gives up at the first failure.
export function RetryLimitPicker({
  limit,
  disabled,
  onChange
}: {
  limit: number
  disabled: boolean
  onChange(limit: number): void
}): React.JSX.Element {
  return (
    <LimitStepper
      name="Retries after a failure"
      shown={String(limit)}
      fewer={{ label: 'Fewer retries after a failure', to: limit - 1, disabled: limit <= 0 }}
      more={{
        label: 'More retries after a failure',
        to: limit + 1,
        disabled: limit >= MAX_RETRY_LIMIT
      }}
      disabled={disabled}
      onChange={onChange}
    />
  )
}
