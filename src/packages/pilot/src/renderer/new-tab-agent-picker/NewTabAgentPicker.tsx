import React, { useCallback, useMemo, useState } from 'react'
import { useShallow } from 'zustand/react/shallow'
import { CommandDialog } from '@/components/ui/command'
import { orderTabLaunchAgents } from '@/components/tab-bar/tab-agent-launch-options'
import type { TerminalController } from '@/components/use-terminal-controller'
import { FooterKey } from '@/components/worktree-jump-palette-primitives'
import { getAgentCatalog } from '@/lib/agent-catalog'
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
import { NewTabAgentStep } from './NewTabAgentStep'
import { NewTabMachineCommand } from './NewTabMachineCommand'
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

// Why: live while open so an offline machine drops out; the whole snapshot only covers the fade-out.
function shownMachines(
  step: PickerStep,
  live: NewTabMachineStep | null,
  visible: boolean
): NewTabMachineStep | null {
  if (step.kind !== 'machine') {
    return null
  }
  if (!visible) {
    return step.machines
  }
  if (live) {
    return live
  }
  // Why: with no live step (one machine left), only the current machine is still known to be up.
  return { ...step.machines, targets: step.machines.targets.filter((t) => t.isCurrent) }
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
  const machineStep = useNewTabMachineStep(activeWorktreeId, visible)
  const [query, setQuery] = useState('')
  const [selectedId, setSelectedId] = useState('')
  const [step, setStep] = useState<PickerStep>(AGENT_STEP)
  const [machineQuery, setMachineQuery] = useState('')
  const [selectedMachine, setSelectedMachine] = useState('')
  // Why: each step mounts its own search box, which takes focus only after a step change.
  const [movedBetweenSteps, setMovedBetweenSteps] = useState(false)
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
      setMovedBetweenSteps(false)
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

  const machines = shownMachines(step, machineStep, visible)
  const detected = useAppStore(
    useShallow((s) => {
      if (!machines) {
        return NO_DETECTIONS
      }
      return machines.targets.map((t) => readDetectedAgentsForWorktree(s, t.worktreeId))
    })
  )

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
      setMovedBetweenSteps(true)
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
    if (step.kind !== 'machine' || !machines) {
      return
    }
    const { agent } = step
    rememberNewTabMachine(machines.projectId, row.hostId)
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
  // Why visible: step 2's state outlives a close, but its Esc must not outlive the dialog.
  useEscapeBack(visible && step.kind === 'machine', back)

  const handleOpenChange = useCallback((open: boolean) => {
    if (!open) {
      setNewTabAgentPickerOpen(false)
    }
  }, [])

  let footerText = workspaceName ? `In ${workspaceName}` : null
  let escLabel = 'Close'
  let description = 'Choose an agent to open in a new tab'
  let stepView: React.JSX.Element
  if (step.kind === 'machine' && machines) {
    footerText = `${step.agentLabel} · choose a machine`
    escLabel = 'Back'
    description = `Choose a machine to open ${step.agentLabel} on`
    const rows = buildNewTabMachineRows({
      targets: machines.targets,
      detected,
      agent: step.agent,
      agentLabel: step.agentLabel,
      query: machineQuery
    })
    stepView = (
      <NewTabMachineCommand
        agentLabel={step.agentLabel}
        query={machineQuery}
        onQueryChange={(value) => {
          setMachineQuery(value)
          setSelectedMachine('')
        }}
        value={highlightedNewTabMachine(rows, selectedMachine, step.lastHostId)}
        onValueChange={setSelectedMachine}
        rows={rows}
        onPick={pickMachine}
      />
    )
  } else {
    stepView = (
      <NewTabAgentStep
        autoFocus={movedBetweenSteps}
        query={query}
        onQueryChange={(value) => {
          setQuery(value)
          setSelectedId('')
        }}
        options={options}
        onPick={pickAgent}
        lookingForAgents={isLoading && detectedIds === null}
      />
    )
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
      description={description}
      contentClassName="w-[480px]"
      commandProps={{ loop: true, value: agentValue, onValueChange: setSelectedId }}
    >
      {stepView}
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
