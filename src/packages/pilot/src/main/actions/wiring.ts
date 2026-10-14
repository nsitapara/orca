import type { EngineEnv } from '../engine-env'
import { pilotcliPath, pilotcliRunner } from '../envs/pilotcli'
import type { LinearWriter } from '../linear-connector/linear-writer'
import { actBridge } from './act-bridge'
import { buildActionCatalog } from './catalog'
import { pushBranchEntry } from './push-branch'
import { startRunEntry } from './start-run-entry'
import type { ActionCatalog } from './types'

// The one catalog Pilot's services build: act.py's mark_ready and post_review, pilotcli's push, the Linear writes and
// start_run. Built once; nothing runs until an action is attempted. start_run reaches the engine lazily.
export function pilotActionCatalog(deps: {
  engineEnv: EngineEnv
  linear: LinearWriter | null
  startRun: Parameters<typeof startRunEntry>[0]
}): ActionCatalog {
  // One lookup for a push card's Run line and the call itself, read at each use (pilotcli.ts).
  const binary = () => pilotcliPath()
  return buildActionCatalog({
    act: actBridge({ engineEnv: deps.engineEnv }),
    push: pushBranchEntry({
      pilotcli: pilotcliRunner({ pilotBinDir: deps.engineEnv.binDir, binary }),
      binary
    }),
    linear: deps.linear,
    extra: [startRunEntry(deps.startRun)]
  })
}
