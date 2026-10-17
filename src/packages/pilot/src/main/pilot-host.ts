import { hostname } from 'node:os'
import type { OrcaRuntimeService } from '../../../../main/runtime/orca-runtime'
import { getAppEnvironment } from '../../../../shared/app-environment'
import { normalizeMachineName } from '../../../../shared/machine-name'
import type { PilotStatus } from '../shared/api-types'
import { pilotAutomationDirs, pilotDataDir } from './env'
import type { PilotHost } from './pilot-context'

// Why the fallback: a runtime with no name set (or no store yet) still has to tag its work.
export function engineMachineName(runtime: Pick<OrcaRuntimeService, 'readMachineName'>): string {
  try {
    const name = normalizeMachineName(runtime.readMachineName())
    if (name) {
      return name
    }
  } catch {
    // fall through to the hostname
  }
  return normalizeMachineName(hostname())
}

export function pilotHostFor(
  runtime: OrcaRuntimeService,
  processKind: PilotStatus['process']
): PilotHost {
  return {
    processKind,
    dirs: pilotAutomationDirs(),
    dataDir: pilotDataDir(processKind, getAppEnvironment().getPath('userData')),
    context: null,
    error: null,
    machineName: () => engineMachineName(runtime)
  }
}
