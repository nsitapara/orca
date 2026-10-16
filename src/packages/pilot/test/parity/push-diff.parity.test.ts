import { execFileSync, spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, realpathSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  committedRangeSha256,
  PUSH_DIFF_ARGS,
  PUSH_DIFF_ENV
} from '../../src/main/inbox/push-range'

// One definition of a pushed range's diff: pilotcli's `git get-diff` (pilotCLI internal/modules/git) makes a push's
// patch, and Pilot recomputes it with PUSH_DIFF_ARGS. They must give the same bytes, or no prepared push passes.
const hasPilotcli = spawnSync('pilotcli', ['self', 'get-version']).status === 0

describe('the canonical push diff: argv and environment', () => {
  it('runs git with every external hook off, fetching nothing, the commits after --end-of-options', () => {
    const args = PUSH_DIFF_ARGS('/wt', 'b'.repeat(40), 'h'.repeat(40))
    expect(args.slice(0, 8)).toEqual([
      '-c',
      'core.fsmonitor=false',
      '-c',
      'core.hooksPath=/dev/null',
      '-c',
      'diff.external=',
      '--no-pager',
      '-C'
    ])
    expect(args.slice(-3)).toEqual(['--end-of-options', 'b'.repeat(40), 'h'.repeat(40)])
    expect(PUSH_DIFF_ENV).toMatchObject({ GIT_NO_LAZY_FETCH: '1', GIT_ALLOW_PROTOCOL: 'file' })
  })
})

describe.skipIf(!hasPilotcli)('the canonical push diff against pilotcli git get-diff', () => {
  it("gives pilotcli's patch byte for byte: an edit, a binary change and a rename", async () => {
    const dir = realpathSync(mkdtempSync(join(tmpdir(), 'pilot-push-diff-')))
    const git = (...a: string[]) =>
      execFileSync('git', ['-C', dir, ...a], { encoding: 'utf8' }).trim()
    git('init', '-q', '-b', 'web-1')
    git('config', 'user.email', 't@t')
    git('config', 'user.name', 't')
    writeFileSync(join(dir, 'a.txt'), 'one\n')
    writeFileSync(join(dir, 'bin.dat'), Buffer.from([0, 1, 2, 3]))
    writeFileSync(join(dir, 'old.txt'), 'rename me\nwith a few lines\nso git sees a rename\n')
    git('add', '.')
    git('commit', '-qm', 'a')
    const base = git('rev-parse', 'HEAD')
    writeFileSync(join(dir, 'a.txt'), 'one\ntwo\n')
    writeFileSync(join(dir, 'bin.dat'), Buffer.from([0, 1, 2, 4]))
    git('mv', 'old.txt', 'new.txt')
    git('add', '.')
    git('commit', '-qm', 'b')
    const head = git('rev-parse', 'HEAD')
    const out = join(dir, '..', `push-${Date.now()}.patch`)
    const made = spawnSync('pilotcli', ['git', 'get-diff', base, head, '-C', dir, '--out', out], {
      encoding: 'utf8'
    })
    expect(made.status).toBe(0)
    const envelope = JSON.parse(made.stdout) as {
      outcome: string
      data: { path: string; sha256: string; bytes: number }
    }
    expect(envelope.outcome).toBe('ok')
    const pilot = execFileSync('git', PUSH_DIFF_ARGS(dir, base, head))
    const written = readFileSync(out)
    expect(written.equals(pilot)).toBe(true)
    expect(envelope.data.bytes).toBe(written.length)
    expect(envelope.data.sha256).toBe(await committedRangeSha256(dir, base, head))
  })
})
