import { useState } from 'react'

// Clear on a Running row. With `confirm` (a kept fix's branch is deleted), the first click asks in place; Delete does it.
export function ClearButton({
  label,
  confirm,
  disabled,
  onClear
}: {
  // Names the row for screen readers: "Clear 15 · Merge back kept fixes, pilot/…".
  label: string
  confirm?: string
  disabled: boolean
  onClear(): void
}): React.JSX.Element {
  const [asking, setAsking] = useState(false)
  if (asking) {
    return (
      <span className="flex shrink-0 items-center gap-2 text-xs">
        <span className="text-muted-foreground">{confirm}</span>
        <button
          type="button"
          className="text-destructive underline disabled:opacity-50"
          disabled={disabled}
          onClick={() => {
            setAsking(false)
            onClear()
          }}
        >
          Delete
        </button>
        <button type="button" className="underline" onClick={() => setAsking(false)}>
          Keep
        </button>
      </span>
    )
  }
  return (
    <button
      type="button"
      aria-label={label}
      className="shrink-0 text-xs underline disabled:opacity-50"
      disabled={disabled}
      onClick={() => (confirm ? setAsking(true) : onClear())}
    >
      Clear
    </button>
  )
}
