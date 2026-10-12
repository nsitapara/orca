import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { RpcCallerIdentity } from '../../../../../../main/runtime/rpc/rpc-caller-identity'
import { loadDefinitions } from '../../definitions/loader'
import type { PilotHost } from '../../pilot-services'
import { buildPilotMethods } from '../../rpc/methods'
import { PilotStore } from '../../store/store'
import { detailsFixture } from './details-fixture'

type Callable = {
  name: string
  handler(p: unknown, ctx?: { caller?: RpcCallerIdentity }): unknown
}

// The CLI belongs to another TypeScript project (config/tsconfig.cli.json), so its modules are loaded by a
// computed path: the typecheck of this project does not follow it, and Vitest still runs the real handler.
type CliModules = {
  args: {
    parseArgs(argv: string[], a: undefined, specs: unknown): unknown
    normalizeCommandPositionals(specs: unknown, parsed: unknown): { flags: unknown }
  }
  handlers: {
    INBOX_HANDLERS: Record<string, (context: unknown) => Promise<void>>
  }
  specs: { PILOT_COMMAND_SPECS: unknown }
}
async function loadCli(): Promise<CliModules> {
  const load = (path: string) => import(/* @vite-ignore */ join(import.meta.dirname, path))
  return {
    args: await load('../../../../../../cli/args'),
    handlers: await load('../../../cli/handlers-inbox'),
    specs: await load('../../../cli/specs')
  }
}

const CLI: RpcCallerIdentity = { kind: 'local-cli' }

// Pilot with one automation (ci) and run-1's step 0 running, its methods called as the local CLI, and
// `pilot inbox …` run through the CLI's own handler, its client wired to those methods. The client answers
// with the runtime's whole envelope, so `--json` prints what the real CLI prints.
export function cliHarness() {
  const f = detailsFixture()
  const dir = mkdtempSync(join(tmpdir(), 'pilot-cli-harness-'))
  writeFileSync(join(dir, 'people.yaml'), 'people:\n  - { id: nish, name: Nish, gitlab: nish8 }\n')
  writeFileSync(
    join(dir, 'ci.yaml'),
    'name: ci\nrepo: r\nschedule: manual\nitems: { kind: merge_request }\nsteps: [ { agent: claude, prompt: x } ]\ninbox: nish\n'
  )
  const loaded = loadDefinitions([dir])
  const store = PilotStore.open(join(dir, 'db.sqlite'))
  store.runs.create({
    id: 'run-1',
    automationId: 'ci',
    tickId: null,
    itemKey: 'mr:1',
    itemLabel: '!1',
    worktreePath: '/wt',
    startedAt: 1
  })
  store.runs.createStep({
    runId: 'run-1',
    idx: 0,
    name: 'draft',
    agent: 'claude',
    skill: null,
    mode: null,
    startedAt: 1,
    status: 'running'
  })
  const host: PilotHost = {
    processKind: 'main',
    dirs: [dir],
    dataDir: dir,
    error: null,
    context: {
      processKind: 'main',
      store,
      dirs: [dir],
      loaded: () => loaded,
      reload: () => loaded,
      scheduler: null as never,
      actions: { entries: () => [], get: () => null },
      dispatcher: null,
      schedulerOn: true,
      detailsRoot: f.root
    }
  }
  const methods = buildPilotMethods(host) as unknown as Callable[]
  const rpc = (name: string, params: unknown): unknown =>
    methods.find((m) => m.name === name)!.handler(params, { caller: CLI })
  const cli = async (argv: string[]): Promise<void> => {
    const { args, handlers, specs } = await loadCli()
    const parsed = args.normalizeCommandPositionals(
      specs.PILOT_COMMAND_SPECS,
      args.parseArgs(argv, undefined, specs.PILOT_COMMAND_SPECS)
    )
    const client = {
      call: async (name: string, params: unknown) => ({
        id: 'cli-harness',
        ok: true,
        result: rpc(name, params),
        _meta: { runtimeId: 'cli-harness' }
      })
    }
    await handlers.INBOX_HANDLERS[`${argv[0]} ${argv[1]}`]({
      flags: parsed.flags,
      client,
      cwd: '/',
      json: true
    })
  }
  return { f, rpc, cli, store }
}
