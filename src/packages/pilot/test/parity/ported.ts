import { readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import type { ScriptRunner } from '../../src/main/fields/script-runner'
import type { IdsRunner } from '../../src/main/sources/ids-from'
import { runTick, type TickDeps } from '../../src/main/scheduler/tick-runner'
import { PilotStore } from '../../src/main/store/store'
import type { ItemDecision } from '../../src/shared/api-types'
import { parseAutomationYaml } from '../../src/shared/definition/parse'
import type { AutomationDefinition } from '../../src/shared/definition/types'
import { parsePeopleYaml, type PeopleDirectory } from '../../src/shared/people'
import { fixtureTickDeps, type ParityFixture } from './fixture'
import { PARITY_DIR } from './old-side'

// The folder the ported automations live in: Nish's ~/.agents/automations, or $PARITY_AUTOMATIONS_DIR (Task 13b's variable).
export function portedAutomationsDir(): string {
  return process.env.PARITY_AUTOMATIONS_DIR || join(homedir(), '.agents', 'automations')
}

export function loadPortedAutomation(id: string): {
  definition: AutomationDefinition
  people: PeopleDirectory
} {
  const dir = portedAutomationsDir()
  const file = join(dir, `${id}.yaml`)
  const parsed = parseAutomationYaml(readFileSync(file, 'utf8'), file)
  if (!parsed.ok) {
    throw new Error(parsed.errors.join('\n'))
  }
  const people = parsePeopleYaml(readFileSync(join(dir, 'people.yaml'), 'utf8'))
  if (!people.ok) {
    throw new Error(people.errors.join('\n'))
  }
  return { definition: parsed.definition, people: people.directory }
}

// Where a case of job `<code>` lives: test/parity/<code>/<case>.json (Task 13a's layout).
export function caseFile(job: string, name: string): string {
  return join(PARITY_DIR, job, `${name}.json`)
}

// One dry tick of the ported definition on a case: a fresh in-memory store, `seed` run first (the sweep's state
// imported, or runs and handled keys put in place), then Task 13b's `fixtureTickDeps` and `runTick` as a dry run.
export async function dryTick(input: {
  definition: AutomationDefinition
  people: PeopleDirectory
  fixture: ParityFixture
  seed?: (store: PilotStore, fixture: ParityFixture) => void
  runScript?: ScriptRunner
  runIds?: IdsRunner
  // Swaps parts of the tick's deps (13's Linear tickets).
  tickDeps?: (deps: TickDeps, fixture: ParityFixture) => TickDeps
}): Promise<ItemDecision[]> {
  const store = PilotStore.open(':memory:')
  try {
    input.seed?.(store, input.fixture)
    const result = await runTick(
      input.definition,
      input.people,
      swapDeps(
        input,
        fixtureTickDeps(input.fixture, store, { runScript: input.runScript, runIds: input.runIds })
      ),
      { dryRun: true }
    )
    if (result.error) {
      throw new Error(result.error)
    }
    return result.decisions
  } finally {
    store.close()
  }
}

function swapDeps(
  input: { fixture: ParityFixture; tickDeps?: (d: TickDeps, f: ParityFixture) => TickDeps },
  deps: TickDeps
): TickDeps {
  return input.tickDeps ? input.tickDeps(deps, input.fixture) : deps
}

// The name of the first check an item failed, or null.
export function failedCheck(decision: ItemDecision | undefined): string | null {
  return decision?.checks.find((c) => !c.ok)?.check ?? null
}

// What holds or skips an item: the first check it failed, else the runner gate holding it ('quota', 'job_limit', …).
export function stoppedBy(decision: ItemDecision | undefined): string | null {
  return failedCheck(decision) ?? decision?.hold?.code ?? null
}

const QUOTA_WORDS = /^(claude|codex) (weekly|session) limit at (\d+)%/

// Whether Pilot's runner holds on the agent, window and percent a sweep's quota skip named. The runner words it
// "claude weekly limit at 95% (jobs stop at 90%)" (runner-gates.ts): no job declares the agent's quota any more.
export function runnerQuotaAgrees(sweepReason: string, reason: string): boolean {
  const [, agent, window, percent] = QUOTA_WORDS.exec(sweepReason) ?? []
  const [, newAgent, newWindow, newPercent] = QUOTA_WORDS.exec(reason) ?? []
  return (
    agent !== undefined &&
    reason.includes('(jobs stop at ') &&
    [agent, window, percent].join() === [newAgent, newWindow, newPercent].join()
  )
}
