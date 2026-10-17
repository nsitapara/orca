import type { ExecutionHostId } from '../../../../../shared/execution-host'
import type { TuiAgent } from '../../../../../shared/tui-agent'
import type { NewTabMachineOpensIn, NewTabMachineTarget } from './new-tab-machine-step'

export type NewTabMachineAvailability = 'detected' | 'missing' | 'checking'
export type NewTabMachineRow = NewTabMachineTarget & { detail: string; disabled: boolean }

const OPENS_IN_TEXT: Record<NewTabMachineOpensIn, string> = {
  'this-workspace': 'this workspace',
  'same-branch': 'same branch',
  'main-checkout': 'main checkout'
}

export function agentAvailability(
  detected: readonly TuiAgent[] | null,
  agent: TuiAgent
): NewTabMachineAvailability {
  if (detected === null) {
    return 'checking'
  }
  return detected.includes(agent) ? 'detected' : 'missing'
}

export function buildNewTabMachineRows(args: {
  targets: readonly NewTabMachineTarget[]
  detected: readonly (readonly TuiAgent[] | null)[]
  agent: TuiAgent
  agentLabel: string
  query: string
}): NewTabMachineRow[] {
  const needle = args.query.trim().toLowerCase()
  const rows: NewTabMachineRow[] = []
  args.targets.forEach((target, index) => {
    // Why: step 1 only listed agents detected on the current machine.
    const missing =
      !target.isCurrent && agentAvailability(args.detected[index] ?? null, args.agent) === 'missing'
    const detail = missing
      ? `${args.agentLabel} not found here`
      : `${target.worktreeName} · ${OPENS_IN_TEXT[target.opensIn]}`
    const haystack = `${target.machineLabel} ${detail}`.toLowerCase()
    if (haystack.includes(needle)) {
      rows.push({ ...target, detail, disabled: missing })
    }
  })
  return rows
}

export function defaultNewTabMachine(
  rows: readonly NewTabMachineRow[],
  lastHostId: ExecutionHostId | null
): ExecutionHostId | null {
  const enabled = rows.filter((row) => !row.disabled)
  const last = lastHostId === null ? undefined : enabled.find((row) => row.hostId === lastHostId)
  const pick = last ?? enabled.find((row) => row.isCurrent) ?? enabled[0]
  return pick?.hostId ?? null
}

export function highlightedNewTabMachine(
  rows: readonly NewTabMachineRow[],
  selected: string,
  lastHostId: ExecutionHostId | null
): string {
  if (rows.some((row) => row.hostId === selected && !row.disabled)) {
    return selected
  }
  return defaultNewTabMachine(rows, lastHostId) ?? ''
}
