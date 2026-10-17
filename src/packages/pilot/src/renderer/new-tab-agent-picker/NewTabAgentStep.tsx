import React from 'react'
import { TerminalSquare } from 'lucide-react'
import {
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList
} from '@/components/ui/command'
import { AgentIcon } from '@/lib/agent-catalog'
import type { NewTabAgentPickerOption } from './new-tab-agent-picker-options'

function OptionIcon({ option }: { option: NewTabAgentPickerOption }): React.JSX.Element {
  if (option.kind === 'agent') {
    return <AgentIcon agent={option.id} size={16} />
  }
  return <TerminalSquare className="text-muted-foreground" />
}

function optionLabel(option: NewTabAgentPickerOption): string {
  return option.kind === 'agent' ? option.entry.label : 'Blank Terminal'
}

/** Step 1: the search box and agent rows, in the dialog's own cmdk root. */
export function NewTabAgentStep({
  autoFocus,
  query,
  onQueryChange,
  options,
  onPick,
  lookingForAgents
}: {
  autoFocus: boolean
  query: string
  onQueryChange: (query: string) => void
  options: readonly NewTabAgentPickerOption[]
  onPick: (option: NewTabAgentPickerOption) => void
  lookingForAgents: boolean
}): React.JSX.Element {
  return (
    <>
      <CommandInput
        autoFocus={autoFocus}
        placeholder="Open a new tab with..."
        value={query}
        onValueChange={onQueryChange}
      />
      <CommandList>
        <CommandEmpty>No agents match your search.</CommandEmpty>
        <CommandGroup>
          {options.map((option) => (
            <CommandItem
              key={option.id}
              value={option.id}
              selection="palette"
              onSelect={() => onPick(option)}
            >
              <OptionIcon option={option} />
              <span className="min-w-0 flex-1 truncate">{optionLabel(option)}</span>
              {option.isDefault ? (
                <span className="text-2xs text-muted-foreground">Default</span>
              ) : null}
            </CommandItem>
          ))}
        </CommandGroup>
        {lookingForAgents ? (
          <div className="px-3 py-2 text-xs text-muted-foreground">
            Looking for installed agents...
          </div>
        ) : null}
      </CommandList>
    </>
  )
}
