import { z } from 'zod'
import { defineMethod } from '../../../../../main/runtime/rpc/core'
import type { PlaygroundService } from '../playground/playground'
import type { PilotContext } from '../pilot-services'

export const PLAYGROUND_NOT_HERE = "The playground runs in Pilot's desktop app, not in this process"
export const PLAYGROUND_NOT_PAIRED =
  'The playground serves only this Mac; start or stop it in Pilot on the Mac'
export const PLAYGROUND_NO_CALLER =
  "Pilot can't tell who is calling; the playground was left as it is"

const Start = z.object({ repoPath: z.string().min(1) })

function playgroundOf(ctx: Pick<PilotContext, 'playground'>): PlaygroundService {
  if (!ctx.playground) {
    throw new Error(PLAYGROUND_NOT_HERE)
  }
  return ctx.playground
}

// Who may start or stop a process on this Mac is the transport's stamp, never a param: this Mac's callers only. The
// playground listens on 127.0.0.1, so a paired device couldn't open it anyway.
function refuseRemote(caller: { kind: string } | undefined): void {
  if (!caller) {
    throw new Error(PLAYGROUND_NO_CALLER)
  }
  if (caller.kind === 'paired-device') {
    throw new Error(PLAYGROUND_NOT_PAIRED)
  }
}

// pilotcli's playground (main/playground): the projects it can serve, its state, Start and Stop.
export function buildPlaygroundMethods(ctx: () => Pick<PilotContext, 'playground'>) {
  return [
    defineMethod({
      name: 'pilot.playground.projects',
      permission: 'workspace',
      params: null,
      handler: () => playgroundOf(ctx()).projects()
    }),
    defineMethod({
      name: 'pilot.playground.status',
      permission: 'workspace',
      params: null,
      handler: () => playgroundOf(ctx()).status()
    }),
    defineMethod({
      name: 'pilot.playground.start',
      permission: 'workspace',
      params: Start,
      handler: (p, rpc) => {
        refuseRemote(rpc?.caller)
        return playgroundOf(ctx()).start(p.repoPath)
      }
    }),
    defineMethod({
      name: 'pilot.playground.stop',
      permission: 'workspace',
      params: null,
      handler: (_p, rpc) => {
        refuseRemote(rpc?.caller)
        return playgroundOf(ctx()).stop()
      }
    })
  ]
}
