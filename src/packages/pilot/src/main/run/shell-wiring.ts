import type { ShellWiring } from './engine-wiring'
import { pilotStepEnv } from './step-launch-plan'

// Where a shell step runs, the workspace startRun recorded on the run, and the §8 step env it gets.
export function pilotShellWiring(): ShellWiring {
  return {
    workspaceOf: async (req) => {
      if (!req.run.worktreePath) {
        throw new Error(`Run ${req.run.id} has no workspace`)
      }
      return { path: req.run.worktreePath }
    },
    envOf: (req) =>
      pilotStepEnv({
        runId: req.run.id,
        stepName: req.definition.steps[req.idx].name,
        stepIdx: req.idx,
        automationId: req.run.automationId,
        itemKey: req.run.itemKey,
        powers: req.definition.powers
      })
  }
}
