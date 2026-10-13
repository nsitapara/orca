import { execFileSync, spawnSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, realpathSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  committedRangeSha256,
  PUSH_DIFF_ARGS,
  PUSH_DIFF_ENV
} from '../../src/main/inbox/push-range'
import { skillsDir } from './old-side'

// One definition of a pushed range's diff: the worker makes a push's patch with context.py push-patch, and Pilot
// recomputes it with PUSH_DIFF_ARGS. They must be the same argv and give the same bytes, or no prepared push passes.
const SCRIPTS = join(skillsDir(), 'prepare-inbox-item-context', 'scripts')
const python = (code: string, ...args: string[]) =>
  spawnSync('python3', ['-c', code, SCRIPTS, ...args], {
    encoding: 'utf8',
    env: { ...process.env, PYTHONDONTWRITEBYTECODE: '1' }
  })

describe.skipIf(
  !existsSync(join(SCRIPTS, 'context.py')) || spawnSync('python3', ['--version']).status !== 0
)('the canonical push diff', () => {
  it("runs with context.py's PUSH_DIFF_ENV", () => {
    const read = python(
      'import json, sys; sys.path.insert(0, sys.argv[1]); import context; print(json.dumps(context.PUSH_DIFF_ENV))'
    )
    expect(read.stderr).toBe('')
    expect(JSON.parse(read.stdout)).toEqual(PUSH_DIFF_ENV)
  })

  it("is context.py's push_diff, argument for argument", () => {
    const read = python(
      'import json, sys; sys.path.insert(0, sys.argv[1]); import context; print(json.dumps(context.push_diff(*sys.argv[2:])))',
      '/wt',
      'b'.repeat(40),
      'h'.repeat(40)
    )
    expect(read.stderr).toBe('')
    expect(JSON.parse(read.stdout)).toEqual(PUSH_DIFF_ARGS('/wt', 'b'.repeat(40), 'h'.repeat(40)))
  })

  it("gives the worker's patch byte for byte", async () => {
    const dir = realpathSync(mkdtempSync(join(tmpdir(), 'pilot-push-diff-')))
    const git = (...a: string[]) =>
      execFileSync('git', ['-C', dir, ...a], { encoding: 'utf8' }).trim()
    git('init', '-q', '-b', 'web-1')
    git('config', 'user.email', 't@t')
    git('config', 'user.name', 't')
    writeFileSync(join(dir, 'a.txt'), 'one\n')
    writeFileSync(join(dir, 'bin.dat'), Buffer.from([0, 1, 2, 3]))
    git('add', '.')
    git('commit', '-qm', 'a')
    const base = git('rev-parse', 'HEAD')
    writeFileSync(join(dir, 'a.txt'), 'one\ntwo\n')
    writeFileSync(join(dir, 'bin.dat'), Buffer.from([0, 1, 2, 4]))
    git('commit', '-qam', 'b')
    const head = git('rev-parse', 'HEAD')
    const out = join(dir, '..', `push-${Date.now()}.patch`)
    const made = python(
      'import json, sys; sys.path.insert(0, sys.argv[1]); import context; print(json.dumps(context.push_patch(*sys.argv[2:])))',
      dir,
      base,
      head,
      out
    )
    expect(made.stderr).toBe('')
    const pilot = execFileSync('git', PUSH_DIFF_ARGS(dir, base, head))
    expect(readFileSync(out).equals(pilot)).toBe(true)
    expect(JSON.parse(made.stdout).sha256).toBe(await committedRangeSha256(dir, base, head))
  })
})
