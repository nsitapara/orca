import { existsSync } from 'node:fs'
import type { OrcaRuntimeService } from '../../../../../main/runtime/orca-runtime'
import type { AutomationDefinition } from '../../shared/definition/types'
import type { PeopleDirectory } from '../../shared/people'
import type { ActionCatalog } from '../actions/types'
import type { QuotaReaders } from '../fields/quota'
import { resolveRepoPath } from '../fields/runtime-facts'
import type { WorktreeFactDeps } from '../fields/worktree-facts'
import type { InboxDeps } from '../inbox/inbox-service'
import { InboxRetirer } from '../inbox/retire'
import { openAgentTerminal, runtimeSessionTerminals } from '../run/launch'
import { glabApiForRepo } from '../sources/gitlab-api'
import type { PilotStore } from '../store/store'
import { AnswerDispatcher } from './dispatcher'
import { gitInFlight, passActivity } from './holds'
import { sessionPromptSender, sessionTerminalProbe } from './session-probe'

export type AnswerWiring = {
  runtime: OrcaRuntimeService
  store: PilotStore
  now(): number
  definitions(): AutomationDefinition[]
  people(): PeopleDirectory
  actions: ActionCatalog
  // The same cached readers the field engine's `quota` check reads (Task 5b).
  quotas: QuotaReaders
  // The field engine's facts: git read with optional locks off, the terminal's draft, its liveness.
  facts: WorktreeFactDeps
  log(message: string): void
}

// The scheduler's answers pass (contract §10): Task 20b's retirer first, then the dispatcher, wired
// to Orca's runtime. Built only in the process that runs the scheduler, like the vault export.
export function wireAnswerDispatcher(w: AnswerWiring): AnswerDispatcher {
  const { runtime, store, now, log } = w
  const repoPath = async (repo: string) => (await resolveRepoPath(runtime, repo)).path
  const inbox: InboxDeps = {
    store,
    now,
    definitions: w.definitions,
    people: w.people,
    knownAction: (name) => w.actions.get(name) !== null,
    actionArgsProblem: (name, args) => w.actions.get(name)?.checkArgs(args) ?? null
  }
  const retirer = new InboxRetirer({
    inbox,
    repoOf: (id) => w.definitions().find((d) => d.id === id)?.repo ?? null,
    gitlab: async (repo) => glabApiForRepo(await repoPath(repo)),
    log
  })
  // The run launcher's own look at and send into a session's terminal (one process per session).
  const terminals = runtimeSessionTerminals(runtime, w.facts)
  const draft = (handle: string) => w.facts.terminalDraft(handle)
  return new AnswerDispatcher({
    inbox,
    attempt: { store, now, catalog: w.actions, definitions: w.definitions, inbox },
    retirer,
    holds: () => ({
      exists: existsSync,
      inFlight: gitInFlight(w.facts),
      activity: passActivity(runtime),
      runsIn: (path) => store.runs.runningInWorktree(path)
    }),
    agents: {
      store,
      now,
      probe: sessionTerminalProbe({
        terminals,
        draft,
        stepOn: (handle) => store.runs.stepsOnTerminal(handle).length > 0
      }),
      quota: (agent) => w.quotas[agent](),
      open: (req) => openAgentTerminal(runtime, req),
      send: sessionPromptSender({ terminals, draft }),
      mainCheckout: repoPath
    },
    log
  })
}
