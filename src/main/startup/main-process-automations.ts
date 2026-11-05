import type { AutomationService } from '../automations/service'
import { createRuntimeAutomationService } from '../automations/runtime-automation-service'
import { mainProcessState as state } from './main-process-state'
import { keepOrcaAutomationsOff } from '../../packages/pilot/src/main/orca-automations-off' // pilot-hook: orca-automations-off

export function initializeMainProcessAutomations(): AutomationService {
  const store = state.store
  const runtime = state.runtime
  const claudeUsage = state.claudeUsage
  const codexUsage = state.codexUsage
  if (!store || !runtime || !claudeUsage || !codexUsage) {
    throw new Error('Runtime and usage stores must be initialized before automations')
  }
  const service = createRuntimeAutomationService({
    store,
    runtime,
    claudeUsage,
    codexUsage,
    // Remote clients mirror schedules; only server processes execute remote_host_service ownership.
    headless: state.isServeMode
  })
  state.automations = service
  keepOrcaAutomationsOff(service, store) // pilot-hook: orca-automations-off
  return service
}
