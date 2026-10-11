import { existsSync } from 'node:fs'
import { defineMethod } from '../../../../../main/runtime/rpc/core'
import type { PilotStatus } from '../../shared/api-types'
import type { PilotHost } from '../pilot-services'

export const PILOT_VERSION = '0.1.0'

// Task 21 adds the automation methods. pilot.status works even when Pilot couldn't start.
export function buildPilotMethods(host: PilotHost) {
  return [
    defineMethod({
      name: 'pilot.status',
      permission: 'workspace',
      params: null,
      handler: (): PilotStatus => ({
        version: PILOT_VERSION,
        process: host.processKind,
        dataPath: host.dataDir,
        automationDirs: host.dirs,
        missingDirs: host.dirs.filter((d) => !existsSync(d)),
        peopleError: host.context?.loaded().peopleError ?? null,
        error: host.error
      })
    })
  ].map((m) => Object.assign(m, { pilot: true }))
}
