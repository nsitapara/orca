import { spawnSync } from 'node:child_process'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
// @ts-expect-error -- .mjs script without type declarations
import { PARITY_DIR, parseArgs, recordFixture } from './record-parity-fixture.mjs'

describe('parseArgs', () => {
  it.each([
    [['--job', '05', '--case', 'today'], { job: '05', kase: 'today', force: false, help: false }],
    [
      ['--job', 'M01', '--case', 'after-merge', '--force'],
      { job: 'M01', kase: 'after-merge', force: true, help: false }
    ]
  ])('%j', (argv, expected) => expect(parseArgs(argv)).toEqual(expected))

  it.each([
    [['--case', 'x'], '--job <code> is required'],
    [['--job', '05'], '--case <name> is required'],
    [['--job', '05', '--case', 'Has Spaces'], '--case may use a-z, 0-9 and - only'],
    [['--job', '05', '--case', 'x', '--apply'], 'Unknown or incomplete argument: --apply']
  ])('rejects %j', (argv, message) => expect(() => parseArgs(argv)).toThrow(message))
})

describe('recordFixture', () => {
  it('records through run_old_plan.py into live-<case>.json, and never overwrites one without --force', () => {
    const root = mkdtempSync(join(tmpdir(), 'pilot-record-'))
    const calls: unknown[] = []
    const runner = (cmd: string, args: string[], opts: unknown) => {
      calls.push([cmd, args, opts])
      writeFileSync(args[3], '{}')
      return { code: 0, stdout: '{"decisions": []}', stderr: '' }
    }
    const out = recordFixture(
      { job: '05', kase: 'today', force: false },
      { runner, root, log: () => {} }
    )
    expect(out).toBe(join(root, '05', 'live-today.json'))
    expect(calls).toEqual([
      [
        'python3',
        [join(PARITY_DIR, 'run_old_plan.py'), '05', '--record', out, '--case', 'today'],
        { timeoutMs: 600_000 }
      ]
    ])
    expect(() =>
      recordFixture({ job: '05', kase: 'today', force: false }, { runner, root, log: () => {} })
    ).toThrow(`${out} exists; pass --force to replace it`)
  })

  it('says why when a recording stops', () => {
    const root = mkdtempSync(join(tmpdir(), 'pilot-record-'))
    const runner = () => ({
      code: 2,
      stdout: '',
      stderr: "parity: not a known read, so it isn't run: ['git', 'fetch']\n"
    })
    expect(() =>
      recordFixture({ job: '05', kase: 'x', force: false }, { runner, root, log: () => {} })
    ).toThrow(
      "The recording stopped (exit 2): parity: not a known read, so it isn't run: ['git', 'fetch']"
    )
  })
})

describe('live fixtures', () => {
  it('stay out of git, while the synthetic ones are tracked', () => {
    const repo = resolve(PARITY_DIR, '../../../../..')
    const ignored = (path: string) =>
      spawnSync('git', ['check-ignore', '-q', path], { cwd: repo }).status
    expect(ignored('src/packages/pilot/test/parity/05/live-today.json')).toBe(0)
    expect(ignored('src/packages/pilot/test/parity/05/synthetic-basic.json')).toBe(1)
  })
})
