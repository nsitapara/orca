import { defineMethod } from '../../../../../main/runtime/rpc/core'
import { ArtifactsListParams } from '../../shared/api-types-artifacts'
import { artifactsService, type ArtifactsService } from '../artifacts/artifacts-service'
import { pilotcliRunner } from '../envs/pilotcli'
import type { PilotContext } from '../pilot-services'

// The artifacts agents made on this Mac (pilotcli's artifacts index), for the Artifacts page, the worktree chips and
// the sidebar's fold-out. Read only: any caller may read it; it holds links, titles, paths and session ids.
export function buildArtifactsMethods(
  ctx: () => Pick<PilotContext, 'engineEnv'>,
  make: (pilotBinDir: string) => ArtifactsService = (dir) =>
    artifactsService({ pilotcli: pilotcliRunner({ pilotBinDir: dir }) })
) {
  let service: ArtifactsService | null = null
  return [
    defineMethod({
      name: 'pilot.artifacts.list',
      permission: 'workspace',
      params: ArtifactsListParams,
      handler: (p) => {
        service ??= make(ctx().engineEnv?.binDir ?? '')
        return service.list(p)
      }
    })
  ]
}
