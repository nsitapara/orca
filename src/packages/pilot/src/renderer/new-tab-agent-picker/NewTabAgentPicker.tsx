import React, { useCallback, useMemo, useState } from 'react'
import { TerminalSquare } from 'lucide-react'
import { useShallow } from 'zustand/react/shallow'
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
import { readDetectedAgentsForWorktree } from '@/lib/agent-detection-target-inventory'
import { useAgentDetectionTargetForWorktree } from '@/hooks/useAgentDetectionTarget'
import { useDetectedAgents } from '@/hooks/useDetectedAgents'
import { useModalReturnFocus } from '@/hooks/useModalReturnFocus'
import { useAppStore } from '@/store'
import { useActiveWorktree } from '@/store/selectors'
import type { ExecutionHostId } from '../../../../../shared/execution-host'
import type { TuiAgent } from '../../../../../shared/tui-agent'
import { DEFAULT_DISABLED_TUI_AGENTS } from '../../../../../shared/tui-agent-selection'
import { pilotStore } from '../store'
import {
  buildNewTabAgentPickerOptions,
  type NewTabAgentPickerOption
} from './new-tab-agent-picker-options'
import {
  setNewTabAgentPickerOpen,
  useNewTabAgentPickerOpen
} from './new-tab-agent-picker-open-state'
import { launchAgentInWorkspace } from './launch-agent-in-workspace'
import { readLastNewTabMachine, rememberNewTabMachine } from './new-tab-machine-memory'
import {
  buildNewTabMachineRows,
  highlightedNewTabMachine,
  type NewTabMachineRow
} from './new-tab-machine-rows'
import type { NewTabMachineStep } from './new-tab-machine-step'
import { NewTabMachineList } from './NewTabMachineList'
import { useEscapeBack } from './use-escape-back'
import { useNewTabMachineStep } from './use-new-tab-machine-step'

type PickerController = Pick<TerminalController, 'activeWorktreeId' | 'handleNewTab'>

// Why `machines`: the entry snapshot keeps step 2 intact while the dialog fades out.
type PickerStep =
  | { kind: 'agent' }
  | {
      kind: 'machine'
      agent: TuiAgent
      agentLabel: string
      lastHostId: ExecutionHostId | null
      machines: NewTabMachineStep
    }

const AGENT_STEP: PickerStep = { kind: 'agent' }
const NO_DETECTIONS: readonly (TuiAgent[] | null)[] = []

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
  const machineStep = useNewTabMachineStep(activeWorktreeId, visible)
  const [query, setQuery] = useState('')
  const [selectedId, setSelectedId] = useState('')
  const [step, setStep] = useState<PickerStep>(AGENT_STEP)
  const [machineQuery, setMachineQuery] = useState('')
  const [selectedMachine, setSelectedMachine] = useState('')
  const { captureReturnFocus, skipReturnFocus } = useModalReturnFocus(visible)

  // Why: reset on open only, so a store update mid-typing never wipes the query.
  const [previousVisible, setPreviousVisible] = useState(visible)
  if (visible !== previousVisible) {
    setPreviousVisible(visible)
    if (visible) {
      setQuery('')
      setSelectedId('')
      setStep(AGENT_STEP)
      setMachineQuery('')
      setSelectedMachine('')
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
  const agentValue = options.some((option) => option.id === selectedId)
    ? selectedId
    : (options[0]?.id ?? '')

  const detected = useAppStore(
    useShallow((s) => {
      if (step.kind !== 'machine') {
        return NO_DETECTIONS
      }
      return step.machines.targets.map((t) => readDetectedAgentsForWorktree(s, t.worktreeId))
    })
  )
  const machineRows =
    step.kind === 'machine'
      ? buildNewTabMachineRows({
          targets: step.machines.targets,
          detected,
          agent: step.agent,
          agentLabel: step.agentLabel,
          query: machineQuery
        })
      : []

  const closeThen = (run: () => void): void => {
    skipReturnFocus()
    setNewTabAgentPickerOpen(false)
    // Why: run after the dialog releases its focus trap so the new tab keeps focus.
    requestAnimationFrame(run)
  }

  const pickAgent = (option: NewTabAgentPickerOption): void => {
    if (option.kind === 'agent' && machineStep) {
      setStep({
        kind: 'machine',
        agent: option.id,
        agentLabel: option.entry.label,
        lastHostId: readLastNewTabMachine(machineStep.projectId),
        machines: machineStep
      })
      setMachineQuery('')
      setSelectedMachine('')
      return
    }
    closeThen(() => {
      if (option.kind === 'blank') {
        handleNewTab()
        return
      }
      if (activeWorktreeId) {
        launchAgentInWorkspace({ worktreeId: activeWorktreeId, agent: option.id })
      }
    })
  }

  const pickMachine = (row: NewTabMachineRow): void => {
    if (step.kind !== 'machine') {
      return
    }
    const { agent } = step
    rememberNewTabMachine(step.machines.projectId, row.hostId)
    const switchTo = row.isCurrent
      ? undefined
      : { executionHostId: row.hostId, machineLabel: row.machineLabel }
    closeThen(() => launchAgentInWorkspace({ worktreeId: row.worktreeId, agent, switchTo }))
  }

  const back = (): void => {
    if (step.kind === 'machine') {
      setSelectedId(step.agent)
    }
    setStep(AGENT_STEP)
  }
  useEscapeBack(step.kind === 'machine', back)

  const handleOpenChange = useCallback((open: boolean) => {
    if (!open) {
      setNewTabAgentPickerOpen(false)
    }
  }, [])

  let placeholder = 'Open a new tab with...'
  let emptyText = 'No agents match your search.'
  let footerText = workspaceName ? `In ${workspaceName}` : null
  let escLabel = 'Close'
  let inputValue = query
  let onInputChange = (value: string): void => {
    setQuery(value)
    setSelectedId('')
  }
  let commandValue = agentValue
  let onCommandValueChange = setSelectedId
  if (step.kind === 'machine') {
    placeholder = `Open ${step.agentLabel} on...`
    emptyText = 'No machines match your search.'
    footerText = `${step.agentLabel} · choose a machine`
    escLabel = 'Back'
    inputValue = machineQuery
    onInputChange = (value) => {
      setMachineQuery(value)
      setSelectedMachine('')
    }
    commandValue = highlightedNewTabMachine(machineRows, selectedMachine, step.lastHostId)
    onCommandValueChange = setSelectedMachine
  }

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
      commandProps={{ loop: true, value: commandValue, onValueChange: onCommandValueChange }}
    >
      <CommandInput placeholder={placeholder} value={inputValue} onValueChange={onInputChange} />
      {/* Why keyed: a fresh list per step stops cmdk reselecting its first row as the old rows unmount. */}
      <CommandList key={step.kind}>
        <CommandEmpty>{emptyText}</CommandEmpty>
        {step.kind === 'machine' ? (
          <NewTabMachineList rows={machineRows} onPick={pickMachine} />
        ) : (
          <CommandGroup>
            {options.map((option) => (
              <CommandItem
                key={option.id}
                value={option.id}
                selection="palette"
                onSelect={() => pickAgent(option)}
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
        )}
        {step.kind === 'agent' && isLoading && detectedIds === null ? (
          <div className="px-3 py-2 text-xs text-muted-foreground">
            Looking for installed agents...
          </div>
        ) : null}
      </CommandList>
      <div className="flex items-center gap-2 border-t border-border/60 px-3.5 py-2.5 text-2xs text-muted-foreground">
        <span className="min-w-0 flex-1 truncate">{footerText}</span>
        <FooterKey>Enter</FooterKey>
        <span>Open</span>
        <FooterKey>↑↓</FooterKey>
        <span>Move</span>
        <FooterKey>Esc</FooterKey>
        <span>{escLabel}</span>
      </div>
    </CommandDialog>
  )
}
