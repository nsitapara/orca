import { describe, expect, it } from 'vitest'
import type { RunRow } from '../../shared/api-types'
import { parseAutomationYaml } from '../../shared/definition/parse'
import type { AutomationDefinition } from '../../shared/definition/types'
import { EMPTY_PEOPLE } from '../../shared/people'
import { fakeFieldDeps, testItem } from '../fields/__fixtures__/field-deps'
import type { LoadedDefinitions } from '../definitions/loader'
import { PilotScheduler } from '../scheduler/scheduler'
import type { SourceAccess } from '../scheduler/tick-decide'
import { runTick, type TickDeps } from '../scheduler/tick-runner'
import type { PassFetchCache } from '../sources/fetch-cache'
import { PilotStore } from '../store/store'
import { handOverRunEnd } from './hand-over'

const AT = Date.UTC(2026, 9, 13, 18, 5)
const STAGE_1 = `name: "13 · Fix red hourly e2e on dev"
job:
  id: "13"
  name: Fix red hourly e2e on dev
  stage: 1
  label: Open or update the ticket
  feeds:
    - { to: starts, pass: { id: ticket }, run: now, caption: the tickets it opens }
repo: web-platform
schedule: "5,35 * * * *"
items: { kind: pipeline, where: { ref: dev } }
workspace: main_checkout
steps:
  - { name: ticket, agent: shell, run: ./ticket.sh, outputs: [ticket] }
`
const STAGE_2 = (enabled: boolean) => `name: "13 · Start fix sessions"
job: { id: "13", stage: 2, label: Start a fix session per ticket }
repo: web-platform
schedule: "6,36 * * * *"
enabled: ${enabled}
items: { kind: linear_ticket, where: { ids_from: { feed: true } } }
once_per: "{ticket.id}"
workspace: main_checkout
steps:
  - { agent: claude, prompt: "/dev-e2e-fix {ticket.id}" }
`

function parsed(yaml: string, file: string): AutomationDefinition {
  const result = parseAutomationYaml(yaml, file)
  if (!result.ok) {
    throw new Error(result.errors.join('\n'))
  }
  return result.definition
}

// Stage 1's run, ended with the ticket output its step wrote to $PILOT_OUTPUT_FILE.
function endedRun(store: PilotStore, ticket: string): RunRow {
  const id = 'dev-e2e-fix-202610131805-t1-1'
  store.runs.create({
    id,
    automationId: 'dev-e2e-fix',
    tickId: 1,
    itemKey: 'pipeline:77',
    itemLabel: '#77',
    worktreePath: '/repo',
    startedAt: AT
  })
  store.runs.createStep({
    runId: id,
    idx: 0,
    name: 'ticket',
    agent: 'shell',
    skill: null,
    startedAt: AT
  })
  store.advance.mergeStepOutputs(id, 0, { ticket })
  store.runs.update(id, { status: 'done', outcome: 'Done', finishedAt: AT })
  return store.runs.get(id) as RunRow
}

// The pieces pilot-services wires: the run's end hands over, the scheduler triggers stage 2, and its real tick reads
// what it was handed (a Linear source reading each id it is given).
function wired(stage2Enabled: boolean) {
  const store = PilotStore.open(':memory:')
  const defs = [
    parsed(STAGE_1, '/a/dev-e2e-fix.yaml'),
    parsed(STAGE_2(stage2Enabled), '/a/starts.yaml')
  ]
  const loaded: LoadedDefinitions = {
    definitions: defs,
    errors: [],
    people: EMPTY_PEOPLE,
    peopleError: null,
    missingDirs: []
  }
  const launched: string[] = []
  const linear: SourceAccess = {
    list: async (_def, ctx) => ({
      items: (ctx.ids ?? []).map((id) =>
        testItem({
          kind: 'linear_ticket',
          key: `linear:${id}`,
          label: id,
          fields: { 'ticket.id': id }
        })
      ),
      warnings: []
    }),
    scope: () => null
  }
  const tickDeps: TickDeps = {
    store,
    now: () => AT,
    resolveRepo: async () => ({ name: 'web-platform', id: 'r', path: '/repo', base: 'origin/dev' }),
    sources: linear,
    fields: fakeFieldDeps(),
    ask: {
      store,
      now: () => AT,
      inbox: { store, now: () => AT, definitions: () => defs, people: () => EMPTY_PEOPLE }
    },
    launch: async (req) => {
      launched.push(req.decision.label)
    }
  }
  const scheduler = new PilotScheduler({
    now: () => AT,
    definitions: () => loaded,
    runTick: (def, opts) => runTick(def, EMPTY_PEOPLE, tickDeps, opts),
    lastTickAt: () => null,
    poll: async () => {},
    reposListed: () => true,
    newPass: () => ({}) as PassFetchCache,
    repoProblem: () => {},
    log: () => {}
  })
  scheduler.start()
  const handOver = (run: RunRow) =>
    handOverRunEnd(
      {
        store,
        now: () => AT,
        definitionFor: (id) => defs.find((d) => d.id === id) ?? null,
        trigger: (id, cause) => scheduler.trigger(id, cause),
        log: () => {}
      },
      run,
      { status: 'done', outcome: 'Done' }
    )
  return { store, scheduler, launched, handOver }
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 0))

describe('a two-stage job hands over and triggers end to end', () => {
  it("stage 1's run ends, stage 2 ticks at once on the ticket it opened, starts its fix and consumes the id", async () => {
    const { store, scheduler, launched, handOver } = wired(true)
    const run = endedRun(store, 'WEB-2123')
    handOver(run)
    await settle()
    await settle()
    expect(launched).toEqual(['WEB-2123'])
    const [tick] = store.listTicks('starts', 1)
    expect(store.handovers.tickTriggers([tick.id]).get(tick.id)).toEqual({
      automationId: 'dev-e2e-fix',
      runId: run.id,
      stage: 1,
      ids: ['WEB-2123']
    })
    expect(store.handovers.pending('starts', 10)).toEqual([])
    expect(store.handovers.latest('dev-e2e-fix', 'starts')).toMatchObject([
      { itemId: 'WEB-2123', state: 'consumed', tickId: tick.id, verdict: 'started' }
    ])
    scheduler.stop()
  })

  it('a stage that is turned off gets no tick, and the id waits for it', async () => {
    const off = wired(false)
    off.handOver(endedRun(off.store, 'WEB-2123'))
    await settle()
    expect(off.store.listTicks('starts', 5)).toEqual([])
    expect(off.store.handovers.pending('starts', 10).map((h) => h.itemId)).toEqual(['WEB-2123'])
    off.scheduler.stop()
  })
})
