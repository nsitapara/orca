import React, { useCallback, useMemo, useState } from 'react'
import { TerminalSquare } from 'lucide-react'
import { toast } from 'sonner'
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList
} from '@/components/ui/command'
import { orderTabLaunchAgents } from '@/components/tab-bar/tab-agent-launch-options'
import type { TerminalController } from '@/components/use-terminal-controller'
import { FooterKey } from '@/components/worktree-jump-palette-primitives'
import { AgentIcon, getAgentCatalog } from '@/lib/agent-catalog'
import { newAgentLaunchRequestId } from '@/lib/agent-launch-request-id'
import { focusTerminalTabSurface } from '@/lib/focus-terminal-tab-surface'
import { launchAgentInNewTab } from '@/lib/launch-agent-in-new-tab'
import { useAgentDetectionTargetForWorktree } from '@/hooks/useAgentDetectionTarget'
import { useDetectedAgents } from '@/hooks/useDetectedAgents'
import { useModalReturnFocus } from '@/hooks/useModalReturnFocus'
import { useAppStore } from '@/store'
import { useActiveWorktree } from '@/store/selectors'
import { DEFAULT_DISABLED_TUI_AGENTS } from '../../../../../shared/tui-agent-selection'
import type { TuiAgent } from '../../../../../shared/tui-agent'
import { pilotStore } from '../store'
import {
  buildNewTabAgentPickerOptions,
  type NewTabAgentPickerOption
} from './new-tab-agent-picker-options'
import {
  setNewTabAgentPickerOpen,
  useNewTabAgentPickerOpen
} from './new-tab-agent-picker-open-state'

type PickerController = Pick<TerminalController, 'activeWorktreeId' | 'handleNewTab'>

// Mirrors the tab bar's quick launch: launch, then focus a local terminal tab.
function launchAgent(worktreeId: string, agent: TuiAgent): void {
  const state = useAppStore.getState()
  const result = launchAgentInNewTab({
    requestId: newAgentLaunchRequestId(),
    agent,
    worktreeId,
    groupId:
      state.activeGroupIdByWorktree[worktreeId] ?? state.groupsByWorktree[worktreeId]?.[0]?.id,
    launchSource: 'shortcut'
  })
  if (!result) {
    toast.error(`Could not build launch command for ${agent}.`)
    return
  }
  if (result.surface.kind === 'local-terminal') {
    focusTerminalTabSurface(result.surface.tabId)
  }
}

export function NewTabAgentPicker({
  controller
}: {
  controller: PickerController
}): React.JSX.Element | null {
  return pilotStore() ? <NewTabAgentPickerDialog controller={controller} /> : null
}

function NewTabAgentPickerDialog({
  controller: { activeWorktreeId, handleNewTab }
}: {
  controller: PickerController
}): React.JSX.Element {
  const visible = useNewTabAgentPickerOpen((s) => s.open)
  const defaultAgent = useAppStore((s) => s.settings?.defaultTuiAgent)
  const disabledTuiAgents = useAppStore(
    (s) => s.settings?.disabledTuiAgents ?? DEFAULT_DISABLED_TUI_AGENTS
  )
  const workspaceName = useActiveWorktree()?.displayName ?? null
  const { detectedIds, isLoading } = useDetectedAgents(
    useAgentDetectionTargetForWorktree(activeWorktreeId)
  )
  const [query, setQuery] = useState('')
  const [selectedId, setSelectedId] = useState('')
  const { captureReturnFocus, skipReturnFocus } = useModalReturnFocus(visible)

  // Why: reset on open only, so a store update mid-typing never wipes the query.
  const [previousVisible, setPreviousVisible] = useState(visible)
  if (visible !== previousVisible) {
    setPreviousVisible(visible)
    if (visible) {
      setQuery('')
      setSelectedId('')
    }
  }

  const agents = useMemo(() => {
    const catalog = getAgentCatalog()
    return orderTabLaunchAgents(defaultAgent, detectedIds ?? [], disabledTuiAgents).flatMap(
      (id) => catalog.find((entry) => entry.id === id) ?? []
    )
  }, [defaultAgent, detectedIds, disabledTuiAgents])
  const options = useMemo(
    () => buildNewTabAgentPickerOptions({ agents, defaultAgent, query }),
    [agents, defaultAgent, query]
  )
  // First row (the default agent on an empty query) is selected until arrows move it.
  const commandValue = options.some((option) => option.id === selectedId)
    ? selectedId
    : (options[0]?.id ?? '')

  const launch = (option: NewTabAgentPickerOption): void => {
    skipReturnFocus()
    setNewTabAgentPickerOpen(false)
    // Why: run after the dialog releases its focus trap so the new tab keeps focus.
    requestAnimationFrame(() => {
      if (option.kind === 'blank') {
        handleNewTab()
        return
      }
      if (activeWorktreeId) {
        launchAgent(activeWorktreeId, option.id)
      }
    })
  }

  const handleOpenChange = useCallback((open: boolean) => {
    if (!open) {
      setNewTabAgentPickerOpen(false)
    }
  }, [])

  return (
    <CommandDialog
      open={visible}
      onOpenChange={handleOpenChange}
      shouldFilter={false}
      onOpenAutoFocus={captureReturnFocus}
      // Why: Radix would refocus the old tab after the exit animation, stealing it from the new one.
      onCloseAutoFocus={(event) => event.preventDefault()}
      title="New tab"
      description="Choose an agent to open in a new tab"
      contentClassName="w-[480px]"
      commandProps={{ loop: true, value: commandValue, onValueChange: setSelectedId }}
    >
      <CommandInput
        placeholder="Open a new tab with..."
        value={query}
        onValueChange={(value) => {
          setQuery(value)
          setSelectedId('')
        }}
      />
      <CommandList>
        <CommandEmpty>No agents match your search.</CommandEmpty>
        <CommandGroup>
          {options.map((option) => (
            <CommandItem
              key={option.id}
              value={option.id}
              selection="palette"
              onSelect={() => launch(option)}
            >
              {option.kind === 'agent' ? (
                <AgentIcon agent={option.id} size={16} />
              ) : (
                <TerminalSquare className="text-muted-foreground" />
              )}
              <span className="min-w-0 flex-1 truncate">
                {option.kind === 'agent' ? option.entry.label : 'Blank Terminal'}
              </span>
              {option.isDefault ? (
                <span className="text-2xs text-muted-foreground">Default</span>
              ) : null}
            </CommandItem>
          ))}
        </CommandGroup>
        {isLoading && detectedIds === null ? (
          <div className="px-3 py-2 text-xs text-muted-foreground">
            Looking for installed agents...
          </div>
        ) : null}
      </CommandList>
      <div className="flex items-center gap-2 border-t border-border/60 px-3.5 py-2.5 text-2xs text-muted-foreground">
        <span className="min-w-0 flex-1 truncate">
          {workspaceName ? `In ${workspaceName}` : null}
        </span>
        <FooterKey>Enter</FooterKey>
        <span>Open</span>
        <FooterKey>↑↓</FooterKey>
        <span>Move</span>
        <FooterKey>Esc</FooterKey>
        <span>Close</span>
      </div>
    </CommandDialog>
  )
}
