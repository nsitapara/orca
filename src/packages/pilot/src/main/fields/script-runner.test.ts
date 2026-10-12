import { realpathSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { describe, expect, it } from 'vitest'
import { resolveScriptCommand, runShellScript } from './script-runner'

const cwd = tmpdir()

describe('runShellScript', () => {
  it('runs with /bin/sh in cwd, the item on stdin and the env added', async () => {
    const result = await runShellScript({
      command: 'printf "%s|%s|" "$PILOT_ITEM_KEY" "$(pwd -P)"; cat',
      cwd,
      stdin: '{"key":"mr:1"}',
      env: { PILOT_ITEM_KEY: 'mr:1' },
      timeoutMs: 5000
    })
    expect(result).toMatchObject({ code: 0, timedOut: false })
    expect(result.stdout).toBe(`mr:1|${realpathSync(cwd)}|{"key":"mr:1"}`)
  })

  it('reports a non-zero exit with its stderr', async () => {
    const result = await runShellScript({
      command: 'echo nope >&2; exit 3',
      cwd,
      stdin: '',
      env: {},
      timeoutMs: 5000
    })
    expect(result).toMatchObject({ code: 3, timedOut: false })
    expect(result.stderr.trim()).toBe('nope')
  })

  it('stops a script that outlives its timeout', async () => {
    const result = await runShellScript({
      command: 'sleep 5',
      cwd,
      stdin: '',
      env: {},
      timeoutMs: 200
    })
    expect(result.timedOut).toBe(true)
  })

  // Like a shell step: the script runs in its own process group, so a timeout stops what it started too.
  it("stops a timed-out script's children with it", async () => {
    const result = await runShellScript({
      command: 'sleep 30 & echo $!; wait',
      cwd,
      stdin: '',
      env: {},
      timeoutMs: 300
    })
    expect(result.timedOut).toBe(true)
    const child = Number(result.stdout.trim())
    expect(child).toBeGreaterThan(0)
    const alive = () => {
      try {
        process.kill(child, 0)
        return true
      } catch {
        return false
      }
    }
    for (let i = 0; i < 40 && alive(); i++) {
      await new Promise((r) => setTimeout(r, 50))
    }
    const stillAlive = alive()
    if (stillAlive) {
      process.kill(child, 'SIGKILL')
    }
    expect(stillAlive).toBe(false)
  })
})

describe('resolveScriptCommand', () => {
  it.each([
    [
      './fields/failed-specs.sh --since 2d',
      '/auto/fix-ci.yaml',
      "'/auto/fields/failed-specs.sh' --since 2d"
    ],
    ['../shared/check.sh', '/auto/sub/x.yaml', "'/auto/shared/check.sh'"],
    ['/usr/local/bin/check', '/auto/x.yaml', '/usr/local/bin/check'],
    ['python3 ~/.agents/x.py', '/auto/x.yaml', 'python3 ~/.agents/x.py'],
    ["./it's.sh", '/a/x.yaml', `'/a/it'\\''s.sh'`]
  ])('%s', (command, file, expected) => {
    expect(resolveScriptCommand(command, file)).toBe(expected)
  })
})
