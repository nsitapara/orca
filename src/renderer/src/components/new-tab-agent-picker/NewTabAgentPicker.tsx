import React, { useCallback, useMemo, useState } from 'react'
import { TerminalSquare } from 'lucide-react'
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList
} from '@/components/ui/command'
import { AgentIcon, getAgentCatalog } from '@/lib/agent-catalog'
import { focusTerminalTabSurface } from '@/lib/focus-terminal-tab-surface'
import type { LaunchAgentInNewTabResult } from '@/lib/launch-agent-in-new-tab'
import { useAgentDetectionTargetForWorktree } from '@/hooks/useAgentDetectionTarget'
import { useDetectedAgents } from '@/hooks/useDetectedAgents'
import { useModalReturnFocus } from '@/hooks/useModalReturnFocus'
import { translate } from '@/i18n/i18n'
import { useAppStore } from '@/store'
import { useActiveWorktree } from '@/store/selectors'
import { DEFAULT_DISABLED_TUI_AGENTS } from '../../../../shared/tui-agent-selection'
import type { TuiAgent } from '../../../../shared/tui-agent'
import { orderTabLaunchAgents } from '../tab-bar/tab-agent-launch-options'
import { FooterKey } from '../worktree-jump-palette-primitives'
import {
  buildNewTabAgentPickerOptions,
  type NewTabAgentPickerOption
} from './new-tab-agent-picker-options'

type NewTabAgentPickerProps = {
  worktreeId: string | null
  onLaunchAgent: (agent: TuiAgent) => LaunchAgentInNewTabResult | undefined
  onOpenBlankTerminal: () => void
}

export function NewTabAgentPicker({
  worktreeId,
  onLaunchAgent,
  onOpenBlankTerminal
}: NewTabAgentPickerProps): React.JSX.Element {
  const visible = useAppStore((s) => s.activeModal === 'new-tab-agent-picker')
  const closeModal = useAppStore((s) => s.closeModal)
  const defaultAgent = useAppStore((s) => s.settings?.defaultTuiAgent)
  const disabledTuiAgents = useAppStore(
    (s) => s.settings?.disabledTuiAgents ?? DEFAULT_DISABLED_TUI_AGENTS
  )
  const workspaceName = useActiveWorktree()?.displayName ?? null
  const { detectedIds, isLoading } = useDetectedAgents(
    useAgentDetectionTargetForWorktree(worktreeId)
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
    closeModal()
    // Why: run after the dialog releases its focus trap so the new tab keeps focus.
    requestAnimationFrame(() => {
      if (option.kind === 'blank') {
        onOpenBlankTerminal()
        return
      }
      const result = onLaunchAgent(option.id)
      if (result?.surface.kind === 'local-terminal') {
        focusTerminalTabSurface(result.surface.tabId)
      }
    })
  }

  const handleOpenChange = useCallback(
    (open: boolean) => {
      if (!open) {
        closeModal()
      }
    },
    [closeModal]
  )

  return (
    <CommandDialog
      open={visible}
      onOpenChange={handleOpenChange}
      shouldFilter={false}
      onOpenAutoFocus={captureReturnFocus}
      // Why: Radix would refocus the old tab after the exit animation, stealing it from the new one.
      onCloseAutoFocus={(event) => event.preventDefault()}
      title={translate('newTabAgentPicker.title', 'New tab')}
      description={translate(
        'newTabAgentPicker.description',
        'Choose an agent to open in a new tab'
      )}
      contentClassName="w-[480px]"
      commandProps={{ loop: true, value: commandValue, onValueChange: setSelectedId }}
    >
      <CommandInput
        placeholder={translate('newTabAgentPicker.placeholder', 'Open a new tab with...')}
        value={query}
        onValueChange={(value) => {
          setQuery(value)
          setSelectedId('')
        }}
      />
      <CommandList>
        <CommandEmpty>
          {translate('newTabAgentPicker.empty', 'No agents match your search.')}
        </CommandEmpty>
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
                {option.kind === 'agent'
                  ? option.entry.label
                  : translate('newTabAgentPicker.blankTerminal', 'Blank Terminal')}
              </span>
              {option.isDefault ? (
                <span className="text-2xs text-muted-foreground">
                  {translate('newTabAgentPicker.default', 'Default')}
                </span>
              ) : null}
            </CommandItem>
          ))}
        </CommandGroup>
        {isLoading && detectedIds === null ? (
          <div className="px-3 py-2 text-xs text-muted-foreground">
            {translate('newTabAgentPicker.detecting', 'Looking for installed agents...')}
          </div>
        ) : null}
      </CommandList>
      <div className="flex items-center gap-2 border-t border-border/60 px-3.5 py-2.5 text-2xs text-muted-foreground">
        <span className="min-w-0 flex-1 truncate">
          {workspaceName
            ? translate('newTabAgentPicker.workspace', 'In {{value0}}', { value0: workspaceName })
            : null}
        </span>
        <FooterKey>{translate('newTabAgentPicker.enterKey', 'Enter')}</FooterKey>
        <span>{translate('newTabAgentPicker.open', 'Open')}</span>
        <FooterKey>↑↓</FooterKey>
        <span>{translate('newTabAgentPicker.move', 'Move')}</span>
        <FooterKey>{translate('newTabAgentPicker.escKey', 'Esc')}</FooterKey>
        <span>{translate('newTabAgentPicker.close', 'Close')}</span>
      </div>
    </CommandDialog>
  )
}
