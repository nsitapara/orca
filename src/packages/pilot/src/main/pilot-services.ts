import type { OrcaRuntimeService } from '../../../../main/runtime/orca-runtime'
import { ALL_RPC_METHODS } from '../../../../main/runtime/rpc/methods/index'
import type { PilotStatus } from '../shared/api-types'
import { applyPilotEnvDefaults } from './env'
import { buildPilotMethods } from './rpc/methods'
import { registerPilotRpcMethods } from './rpc/register'

export type PilotServices = { stop: () => void }

// Shared by desktop/serve and orcad. M1 adds the store, loader and scheduler here (Task 20).
export function startPilotServices(
  _runtime: OrcaRuntimeService,
  processKind: PilotStatus['process']
): PilotServices {
  applyPilotEnvDefaults()
  registerPilotRpcMethods(ALL_RPC_METHODS as unknown[], buildPilotMethods(processKind))
  console.log(`[pilot] attached (${processKind})`)
  return { stop: () => {} }
}
