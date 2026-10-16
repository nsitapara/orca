import { homedir } from 'node:os'
import { join } from 'node:path'
import { defineMethod } from '../../../../../main/runtime/rpc/core'
import type { SourceIndex } from '../../shared/source-types'
import { pilotcliRunner } from '../envs/pilotcli'
import type { PilotContext } from '../pilot-services'
import { readSourceIndex, sourceIndexReader } from '../step-source/source-index'

// Where a chain step's code is, for its Source link (shared/run-views/step-source.ts). Read only.
export function buildStepSourceMethods(
  ctx: () => Pick<PilotContext, 'engineEnv'>,
  skillsDir: string = join(homedir(), '.agents', 'skills')
) {
  let index: (() => Promise<SourceIndex>) | null = null
  return [
    defineMethod({
      name: 'pilot.sourceIndex.get',
      permission: 'workspace',
      params: null,
      handler: () => {
        index ??= sourceIndexReader(() =>
          readSourceIndex(pilotcliRunner({ pilotBinDir: ctx().engineEnv?.binDir ?? '' }), skillsDir)
        )
        return index()
      }
    })
  ]
}
