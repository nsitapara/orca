import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { fsStateReader, sweepStatePaths } from './fs-reader'

function reader() {
  const root = mkdtempSync(join(tmpdir(), 'pilot-state-'))
  const paths = {
    stateRoot: join(root, 'state'),
    vaultAutomations: join(root, 'vault'),
    dataDir: join(root, 'data')
  }
  mkdirSync(join(paths.stateRoot, 'ci-fix'), { recursive: true })
  mkdirSync(join(paths.vaultAutomations, '09 · Job'), { recursive: true })
  writeFileSync(join(paths.stateRoot, 'ci-fix', 'handled.json'), '{"1587": 2933991087}')
  writeFileSync(join(paths.stateRoot, 'ci-fix', 'broken.json'), '{')
  for (const name of ['Runs.md', 'Items.md', 'details.json']) {
    writeFileSync(join(paths.vaultAutomations, '09 · Job', name), `# ${name}`)
  }
  return { paths, read: fsStateReader(paths) }
}

describe('fsStateReader', () => {
  it('reads a state file as JSON, and a missing one as null', () => {
    const { read } = reader()
    expect(read.json('ci-fix/handled.json')).toEqual({ '1587': 2933991087 })
    expect(read.json('ci-fix/tabs.json')).toBeNull()
  })

  it('names the file when its JSON is broken', () => {
    const { paths, read } = reader()
    expect(() => read.json('ci-fix/broken.json')).toThrow(
      join(paths.stateRoot, 'ci-fix', 'broken.json')
    )
  })

  it("lists a job folder's notes, .md only and sorted, and reads one", () => {
    const { read } = reader()
    expect(read.notes('09 · Job')).toEqual(['Items.md', 'Runs.md'])
    expect(read.notes('missing')).toEqual([])
    expect(read.note('09 · Job/Items.md')).toBe('# Items.md')
    expect(read.note('09 · Job/nope.md')).toBeNull()
  })

  it("takes both roots from the environment, else the old sweeps' own folders", () => {
    expect(
      sweepStatePaths('/data', { PILOT_SWEEP_STATE_ROOT: '/s', PILOT_VAULT_AUTOMATIONS: '/v' })
    ).toEqual({
      stateRoot: '/s',
      vaultAutomations: '/v',
      dataDir: '/data'
    })
    expect(sweepStatePaths('/data', {}).stateRoot).toMatch(
      /Documents\/web-platform\/\.git\/agent-loops$/
    )
    expect(sweepStatePaths('/data', {}).vaultAutomations).toMatch(
      /Documents\/WebPortal\/Agent Work\/Automations$/
    )
  })

  it('serves the live worktrees and the clock it was given, else none and now', () => {
    const { paths } = reader()
    const worktrees = [{ id: 'r::/wt/a', path: '/wt/a', branch: 'web-1-a' }]
    const live = fsStateReader(paths, { worktrees, now: 7 })
    expect([live.worktrees(), live.now]).toEqual([worktrees, 7])
    const bare = fsStateReader(paths)
    expect(bare.worktrees()).toEqual([])
    expect(bare.now).toBeGreaterThan(1_700_000_000_000)
  })
})
