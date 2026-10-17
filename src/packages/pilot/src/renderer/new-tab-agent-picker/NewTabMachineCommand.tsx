import React, { useLayoutEffect, useRef, useState } from 'react'
import { Command, CommandEmpty, CommandInput, CommandList } from '@/components/ui/command'
import type { NewTabMachineRow } from './new-tab-machine-rows'
import { NewTabMachineList } from './NewTabMachineList'

/** Step 2's own cmdk root: search box and machine rows. */
export function NewTabMachineCommand({
  agentLabel,
  query,
  onQueryChange,
  value,
  onValueChange,
  rows,
  onPick
}: {
  agentLabel: string
  query: string
  onQueryChange: (query: string) => void
  value: string
  onValueChange: (value: string) => void
  rows: readonly NewTabMachineRow[]
  onPick: (row: NewTabMachineRow) => void
}): React.JSX.Element {
  // Why: cmdk selects its first row after a search change; only a key or the pointer is the user's pick.
  const searchMoved = useRef(false)
  // Why: cmdk moves its own value before reporting it, so an ignored pick is echoed back, then undone.
  const [cmdkPick, setCmdkPick] = useState<string | null>(null)
  useLayoutEffect(() => {
    if (cmdkPick !== null) {
      setCmdkPick(null)
    }
  }, [cmdkPick])
  const userMoves = (): void => {
    searchMoved.current = false
  }
  const handleValueChange = (next: string): void => {
    if (!searchMoved.current) {
      onValueChange(next)
    } else if (next !== value) {
      setCmdkPick(next)
    }
  }
  return (
    // Why its own root: cmdk reselects its first row whenever the search changes, so steps can't share one.
    <Command
      loop
      shouldFilter={false}
      value={cmdkPick ?? value}
      onValueChange={handleValueChange}
      onKeyDownCapture={userMoves}
      onPointerMoveCapture={userMoves}
    >
      {/* Mounts only on a step change, never on open, so the dialog's focus capture is untouched. */}
      <CommandInput
        autoFocus
        placeholder={`Open ${agentLabel} on...`}
        value={query}
        onValueChange={(next) => {
          searchMoved.current = true
          onQueryChange(next)
        }}
      />
      <CommandList>
        <CommandEmpty>No machines match your search.</CommandEmpty>
        <NewTabMachineList rows={rows} onPick={onPick} />
      </CommandList>
    </Command>
  )
}
