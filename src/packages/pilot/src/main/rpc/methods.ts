import { existsSync } from 'node:fs'
import { defineMethod } from '../../../../../main/runtime/rpc/core'
import { getAppEnvironment } from '../../../../../shared/app-environment'
import type { PilotStatus } from '../../shared/api-types'
import { pilotAutomationDirs } from '../env'

export const PILOT_VERSION = '0.1.0'

export function buildPilotMethods(processKind: PilotStatus['process']) {
  return [
    defineMethod({
      name: 'pilot.status',
      permission: 'workspace',
      params: null,
      handler: (): PilotStatus => {
        const dirs = pilotAutomationDirs()
        return {
          version: PILOT_VERSION,
          process: processKind,
          dataPath: getAppEnvironment().getPath('userData'),
          automationDirs: dirs,
          missingDirs: dirs.filter((d) => !existsSync(d))
        }
      }
    })
  ].map((m) => Object.assign(m, { pilot: true }))
}
