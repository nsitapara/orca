import React from 'react'
import { HostRowIcon } from '@/components/host-row-icon'
import { CommandGroup, CommandItem } from '@/components/ui/command'
import type { NewTabMachineRow } from './new-tab-machine-rows'

export function NewTabMachineList({
  rows,
  onPick
}: {
  rows: readonly NewTabMachineRow[]
  onPick: (row: NewTabMachineRow) => void
}): React.JSX.Element {
  return (
    <CommandGroup>
      {rows.map((row) => (
        <CommandItem
          key={row.hostId}
          value={row.hostId}
          disabled={row.disabled}
          selection="palette"
          onSelect={() => onPick(row)}
        >
          <HostRowIcon hostId={row.hostId} />
          <span className="min-w-0 truncate">{row.machineLabel}</span>
          <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground">
            {row.detail}
          </span>
          {row.isCurrent ? <span className="text-2xs text-muted-foreground">Current</span> : null}
        </CommandItem>
      ))}
    </CommandGroup>
  )
}
