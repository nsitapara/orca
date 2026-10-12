import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { HandlerContext } from '../../../../cli/dispatch'
import { LONG_CALL_TIMEOUT_MS, PILOT_HANDLERS } from './handlers'

const VALID = `name: Fix failed CI
repo: web-platform
schedule: "10 * * * *"
items:
  kind: merge_request
  where: { state: open }
once_per: "{mr.iid}:{mr.pipeline}"
steps:
  - agent: claude
    prompt: Fix it
`

function ctx(flags: Record<string, string>, client: unknown = {}): HandlerContext {
  return {
    flags: new Map(Object.entries(flags)),
    client,
    cwd: '/',
    json: false
  } as HandlerContext
}

describe('automations validate', () => {
  let dir: string
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'pilot-validate-'))
    process.exitCode = 0
  })
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
    process.exitCode = 0
    vi.restoreAllMocks()
  })

  it('prints the errors and sets exit code 1 for an invalid file', async () => {
    const file = join(dir, 'bad.yaml')
    writeFileSync(file, 'name: x\nbogus: 1\n')
    const err = vi.spyOn(console, 'error').mockImplementation(() => {})
    await PILOT_HANDLERS['automations validate'](ctx({ file }))
    expect(err).toHaveBeenCalled()
    expect(process.exitCode).toBe(1)
  })

  it('throws a clear error for a missing file', async () => {
    const file = join(dir, 'nope.yaml')
    await expect(PILOT_HANDLERS['automations validate'](ctx({ file }))).rejects.toThrow(
      `Can't read ${file}: ENOENT`
    )
  })

  it('prints ok <id> and leaves the exit code alone for a valid file', async () => {
    const file = join(dir, 'fix-ci.yaml')
    writeFileSync(file, VALID)
    const log = vi.spyOn(console, 'log').mockImplementation(() => {})
    await PILOT_HANDLERS['automations validate'](ctx({ file }))
    expect(log).toHaveBeenCalledWith('ok fix-ci')
    // Bun starts exitCode at 0 and ignores undefined, so the hooks reset to 0 and this accepts either.
    expect(process.exitCode ?? 0).toBe(0)
  })
})

describe('long calls', () => {
  it.each([
    ['automations tick', 'pilot.automations.tickNow'],
    ['automations dry-run', 'pilot.automations.dryRun']
  ])('%s calls %s with a timeout of at least 120 s', async (key, method) => {
    const call = vi.fn().mockResolvedValue({ result: { status: 'busy' } })
    vi.spyOn(console, 'log').mockImplementation(() => {})
    vi.stubEnv('ORCA_TERMINAL_HANDLE', '')
    vi.stubEnv('PILOT_RUN_ID', '')
    await PILOT_HANDLERS[key](ctx({ id: 'a' }, { call }))
    vi.unstubAllEnvs()
    expect(call).toHaveBeenCalledWith(method, { id: 'a' }, { timeoutMs: LONG_CALL_TIMEOUT_MS })
    expect(LONG_CALL_TIMEOUT_MS).toBeGreaterThanOrEqual(120_000)
  })

  // The server refuses a tick from an agent in a run; it can only tell from where the call comes.
  it('automations tick sends the terminal and run it is called from', async () => {
    const call = vi.fn().mockResolvedValue({ result: { status: 'busy' } })
    vi.spyOn(console, 'log').mockImplementation(() => {})
    vi.stubEnv('ORCA_TERMINAL_HANDLE', 'term-1')
    vi.stubEnv('PILOT_RUN_ID', 'run-1')
    vi.stubEnv('PILOT_STEP_IDX', '0')
    await PILOT_HANDLERS['automations tick'](ctx({ id: 'a' }, { call }))
    vi.unstubAllEnvs()
    expect(call).toHaveBeenCalledWith(
      'pilot.automations.tickNow',
      { id: 'a', terminal: 'term-1', runId: 'run-1', stepIdx: 0 },
      { timeoutMs: LONG_CALL_TIMEOUT_MS }
    )
  })
})
