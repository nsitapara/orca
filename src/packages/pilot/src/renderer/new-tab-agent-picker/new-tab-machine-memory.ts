import {
  normalizeExecutionHostId,
  type ExecutionHostId
} from '../../../../../shared/execution-host'

export const NEW_TAB_MACHINE_KEY = 'pilot.new-tab.machine-by-project'

function readMap(): Record<string, unknown> {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(NEW_TAB_MACHINE_KEY) ?? 'null')
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
      return {}
    }
    return { ...parsed }
  } catch {
    return {}
  }
}

export function readLastNewTabMachine(projectId: string): ExecutionHostId | null {
  const value = readMap()[projectId]
  return typeof value === 'string' ? normalizeExecutionHostId(value) : null
}

export function rememberNewTabMachine(projectId: string, hostId: ExecutionHostId): void {
  try {
    localStorage.setItem(NEW_TAB_MACHINE_KEY, JSON.stringify({ ...readMap(), [projectId]: hostId }))
  } catch {
    // storage unavailable: the machine just isn't remembered
  }
}
