import type {
  ContinueRunResult,
  PilotStatus,
  SessionResumeResult,
  UsageReportResult
} from '../shared/api-types'
import type { AgentKind } from '../shared/definition/types'
import type { ActionCatalog } from './actions/types'
import type { AnswerDispatcher } from './answers/dispatcher'
import type { RunMemorySampler } from './capacity/run-memory'
import type { LoadedDefinitions } from './definitions/loader'
import type { EngineEnv } from './engine-env'
import type { QuotaReader } from './fields/quota'
import type { PlaygroundService } from './playground/create'
import type { PilotScheduler } from './scheduler/scheduler'
import type { PilotStore } from './store/store'

// What a running Pilot holds (pilot-services.ts opens it); every RPC method reads it.
export type PilotContext = {
  processKind: PilotStatus['process']
  store: PilotStore
  dirs: string[]
  loaded(): LoadedDefinitions
  reload(): LoadedDefinitions
  scheduler: PilotScheduler
  // Every outside effect goes through it (contract §10).
  actions: ActionCatalog
  // Saved answers' dispatcher (Task 24c); null in a process that doesn't run the scheduler.
  dispatcher: AnswerDispatcher | null
  // This process runs the scheduler: only here does a real tick or an ask-first start launch anything.
  schedulerOn: boolean
  writeUsageReport?: (dir?: string) => UsageReportResult
  // How engine children reach Pilot's CLI and data (H9).
  engineEnv?: EngineEnv
  // Opens or focuses a step's agent session (pilot.session.resume); absent where there is no runtime.
  resumeSession?: (req: { runId: string; stepIdx: number }) => Promise<SessionResumeResult>
  // Continues a failed run where it broke (run/run-continue.ts); absent where the run engine isn't.
  continueRun?: (runId: string) => Promise<ContinueRunResult>
  // The Automations folder every card's Details bundle must live in; null reads no bundle.
  detailsRoot?: string | null
  // pilotcli's playground (main/playground); absent in orcad, which has no launcher folder for View source.
  playground?: PlaygroundService
  // Running runs' memory, sampled on the scheduler's poll (main/capacity); absent where nothing samples it.
  memory?: RunMemorySampler
}
export type PilotServices = { stop: () => void; context: PilotContext }
// What pilot.status reads. It is registered before anything opens, so status still answers (with
// `error`) when Pilot couldn't start.
export type PilotHost = {
  processKind: PilotStatus['process']
  dirs: string[]
  dataDir: string
  context: PilotContext | null
  error: string | null
  // The machine's name as the runtime publishes it; absent in test hosts.
  machineName?: () => string
}
export type PilotServiceOptions = {
  quotas?: Partial<Record<AgentKind, QuotaReader>>
  // Where the engine's child processes find Pilot's CLI and data (H9). Absent in orcad.
  engineEnv?: EngineEnv
  // Pilot's own static files (env.ts pilotResourcesDir). Absent in orcad, whose token report has no HTML page.
  resourcesDir?: string
  schedulerEnabled?: boolean
  // Tick only the jobs pinned to this machine (PILOT_SCHEDULER=pinned).
  pinnedOnly?: boolean
}
