import { existsSync } from 'node:fs'
import { defineMethod } from '../../../../../main/runtime/rpc/core'
import { getAppEnvironment } from '../../../../../shared/app-environment'
import type { PilotStatus } from '../../shared/api-types'
import type { PilotContext } from '../pilot-services'

export const PILOT_VERSION = '0.1.0'

// Task 21 adds the automation methods; until then pilot.status reads the shared context.
export function buildPilotMethods(context: PilotContext) {
  return [
    defineMethod({
      name: 'pilot.status',
      permission: 'workspace',
      params: null,
      handler: (): PilotStatus => {
        const { dirs } = context
        return {
          version: PILOT_VERSION,
          process: context.processKind,
          dataPath: getAppEnvironment().getPath('userData'),
          automationDirs: dirs,
          missingDirs: dirs.filter((d) => !existsSync(d)),
          peopleError: context.loaded().peopleError
        }
      }
    })
  ].map((m) => Object.assign(m, { pilot: true }))
}
