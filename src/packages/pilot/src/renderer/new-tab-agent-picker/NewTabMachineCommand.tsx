import React from 'react'
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
  return (
    // Why its own root: cmdk reselects its first row whenever the search changes, so steps can't share one.
    <Command loop shouldFilter={false} value={value} onValueChange={onValueChange}>
      {/* Mounts only on a step change, never on open, so the dialog's focus capture is untouched. */}
      <CommandInput
        autoFocus
        placeholder={`Open ${agentLabel} on...`}
        value={query}
        onValueChange={onQueryChange}
      />
      <CommandList>
        <CommandEmpty>No machines match your search.</CommandEmpty>
        <NewTabMachineList rows={rows} onPick={onPick} />
      </CommandList>
    </Command>
  )
}
