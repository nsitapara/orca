import type { OrcaRuntimeService } from '../../../../../main/runtime/orca-runtime'
import type { ItemDecision } from '../../shared/api-types'
import type { AutomationDefinition } from '../../shared/definition/types'
import { renderTemplate } from '../../shared/template'
import type { LaunchRequest, LaunchResult } from '../scheduler/tick-runner'
import type { PilotStore } from '../store/store'

// A placeholder whose field is missing stays literal (renderTemplate's behaviour); nothing is appended.
export function buildPrompt(
  def: AutomationDefinition,
  decision: ItemDecision,
  runId: string
): string {
  const step = def.steps[0]
  const lines = [
    `Started by the Pilot automation "${def.name}" (run ${runId}) for ${decision.label}.`
  ]
  if (step.skill) {
    lines.push(`Use the ${step.skill} skill.`)
  }
  lines.push('', renderTemplate(step.prompt, decision.fields).text.trimEnd())
  return lines.join('\n')
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

// Prefer the repo-qualified id (no cross-host ambiguity, has a fast path); fall back to the path.
function worktreeSelectorOf(decision: ItemDecision): string {
  const id = decision.fields['worktree.id']
  if (typeof id === 'string' && id !== '') {
    return `id:${id}`
  }
  const path = decision.fields['worktree.path']
  if (typeof path !== 'string' || path === '') {
    throw new Error('worktree is gone')
  }
  return `path:${path}`
}

// Best effort: the failure being reported matters more than a second failure while recording it.
function failStep(store: PilotStore, runId: string, error: string, at: number): void {
  try {
    store.runs.updateStep(runId, 0, { status: 'failed', error, finishedAt: at })
  } catch {}
}

export function makeLauncher(
  runtime: OrcaRuntimeService,
  store: PilotStore,
  now: () => number
): (req: LaunchRequest) => Promise<LaunchResult> {
  return async ({ runId, definition, decision }) => {
    const step = definition.steps[0]
    const selector = worktreeSelectorOf(decision)
    store.runs.createStep({
      runId,
      idx: 0,
      name: step.name,
      agent: step.agent,
      skill: step.skill,
      startedAt: now()
    })
    let terminal: { handle: string; paneKey?: string | null }
    try {
      terminal = await runtime.launchAgentTerminal(selector, {
        agent: step.agent,
        prompt: buildPrompt(definition, decision, runId),
        title: `${definition.name} · ${decision.label}`
      })
    } catch (error) {
      const message = messageOf(error)
      const reason = message === 'selector_not_found' ? 'worktree is gone' : message
      failStep(store, runId, reason, now())
      throw new Error(reason)
    }
    try {
      const { paneKey } = terminal
      if (!paneKey) {
        throw new Error('the runtime returned no pane to watch')
      }
      const recorded = store.runs.updateStartingStep(runId, 0, {
        status: 'running',
        terminalHandle: terminal.handle,
        paneKey
      })
      // The stale-start sweep closed this step during a slow launch: never bring it back to life.
      if (!recorded) {
        throw new Error('the run was closed before its agent started')
      }
      return { terminalHandle: terminal.handle, paneKey }
    } catch (error) {
      // The terminal exists but no row tracks it. Say which one, so the failure points at the orphan.
      const message = `terminal ${terminal.handle} started but couldn't be recorded: ${messageOf(error)}`
      console.error(`pilot: ${message}`)
      failStep(store, runId, message, now())
      throw new Error(message)
    }
  }
}
