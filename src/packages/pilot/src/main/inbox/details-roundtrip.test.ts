import { createHash } from 'node:crypto'
import { mkdtempSync, readFileSync, realpathSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { RpcCallerIdentity } from '../../../../../main/runtime/rpc/rpc-caller-identity'
import { loadDefinitions } from '../definitions/loader'
import type { PilotHost } from '../pilot-services'
import { buildPilotMethods } from '../rpc/methods'
import { PilotStore } from '../store/store'
import { copyBundle, detailsFixture, rewriteBundle } from './__fixtures__/details-fixture'

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
    args: await load('../../../../../cli/args'),
    handlers: await load('../../cli/handlers-inbox'),
    specs: await load('../../cli/specs')
  }
}

const CLI: RpcCallerIdentity = { kind: 'local-cli' }
const sha256 = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex')

function setup() {
  const f = detailsFixture()
  const dir = mkdtempSync(join(tmpdir(), 'pilot-roundtrip-'))
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
  // The CLI's own handler, with its client wired to the real method handlers.
  const cli = async (argv: string[]): Promise<void> => {
    const { args, handlers, specs } = await loadCli()
    const parsed = args.normalizeCommandPositionals(
      specs.PILOT_COMMAND_SPECS,
      args.parseArgs(argv, undefined, specs.PILOT_COMMAND_SPECS)
    )
    const client = {
      call: async (name: string, params: unknown) => ({
        result: rpc(name, params)
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

type Listed = {
  items: { id: string; details: { path: string; sha256: string } | null }[]
}

describe('a Details bundle through the CLI, the store and the details RPCs', () => {
  afterEach(() => {
    vi.unstubAllEnvs()
    vi.restoreAllMocks()
  })

  it('round-trips: add, list, details, image, then set-details from a run step', async () => {
    // An add with a bundle needs the same scope as set-details (ruling 4): a step of the card's automation.
    vi.stubEnv('PILOT_RUN_ID', 'run-1')
    vi.stubEnv('PILOT_STEP_IDX', '0')
    vi.stubEnv('PILOT_AUTOMATION_ID', '')
    vi.stubEnv('PILOT_ITEM_KEY', '')
    vi.spyOn(console, 'log').mockImplementation(() => undefined)
    const { f, rpc, cli } = setup()
    await cli([
      'inbox',
      'add',
      '--type',
      'question',
      '--title',
      'Keep the guard?',
      '--details-bundle',
      f.bundle,
      '--automation',
      'ci',
      '--item',
      'mr:1'
    ])

    const { items } = rpc('pilot.inbox.list', {}) as Listed
    expect(items).toHaveLength(1)
    const { id, details } = items[0]
    expect(details?.path).toBe(realpathSync(f.bundle))
    expect(details?.sha256).toBe(sha256(readFileSync(f.bundle)))

    const first = rpc('pilot.inbox.details', { id }) as {
      digest: string
      snapshot: { bundle: unknown }
    }
    expect(first.snapshot.bundle).toEqual(JSON.parse(readFileSync(f.bundle, 'utf8')))

    for (const file of ['F2-before.png', 'F2-after.png', 'F2-qa.png']) {
      const bytes = readFileSync(join(f.dir, file))
      expect(rpc('pilot.inbox.image', { id, digest: first.digest, file })).toEqual({
        mime: 'image/png',
        base64: bytes.toString('base64'),
        bytes: bytes.length
      })
    }
    expect(() => rpc('pilot.inbox.image', { id, digest: first.digest, file: 'F2.patch' })).toThrow(
      /^Details bundle refused: /
    )

    const versionBefore = (rpc('pilot.inbox.get', { id }) as { version: number }).version
    const changed = copyBundle(f, 'F2-v2.json')
    rewriteBundle(changed, (b) => {
      b.blocks[0].rows = [['Applies', 'a different fact']]
    })
    await cli(['inbox', 'set-details', '--id', id, '--bundle', changed])
    const second = rpc('pilot.inbox.details', { id }) as {
      digest: string
      snapshot: {
        bundle: { blocks: { rows: string[][] }[] }
        ref: { path: string }
      }
    }
    expect((rpc('pilot.inbox.get', { id }) as { version: number }).version).toBeGreaterThan(
      versionBefore
    )
    expect(second.digest).not.toBe(first.digest)
    expect(second.snapshot.bundle.blocks[0].rows).toEqual([['Applies', 'a different fact']])
    expect(second.snapshot.ref.path).toBe(realpathSync(changed))
  })
})
