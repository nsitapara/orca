import { describe, expect, it, vi } from 'vitest'
// @ts-expect-error -- .mjs script without type declarations
import * as install from './install-mac.mjs'

type Call = { cmd: string; args: string[] }
type Result = { code: number; stdout: string; stderr: string }
type Responder = (call: Call) => Partial<Result> | undefined

// Stubbed shell: records every call; the clock advances only when the code sleeps.
function makeDeps(respond: Responder = () => undefined) {
  const calls: Call[] = []
  let clock = 0
  const deps = {
    home: '/h',
    log: vi.fn(),
    now: () => clock,
    sleep: async (ms: number) => {
      clock += ms
    },
    run: (cmd: string, args: string[]) => {
      const call = { cmd, args }
      calls.push(call)
      return { code: 0, stdout: '', stderr: '', ...respond(call) }
    }
  }
  return { deps, calls }
}

const AUTOMATIONS = JSON.stringify({
  ok: true,
  result: {
    automations: [
      { id: 'a', enabled: true },
      { id: 'b', enabled: false },
      { name: 'c', enabled: true }
    ]
  }
})

describe('quitPilot', () => {
  it('does nothing when Pilot is not running', async () => {
    const { deps, calls } = makeDeps(() => ({ code: 1 }))
    await install.quitPilot(deps)
    expect(calls.map((c) => c.cmd)).toEqual(['pgrep'])
  })

  it('quits by bundle id and waits for the main process to exit', async () => {
    let checks = 0
    const { deps, calls } = makeDeps((c) =>
      c.cmd === 'pgrep' ? { code: ++checks < 4 ? 0 : 1 } : undefined
    )
    await install.quitPilot(deps)
    expect(calls.find((c) => c.cmd === 'osascript')?.args[1]).toContain('dev.nsitapara.pilot')
    expect(checks).toBe(4)
  })

  it('fails after the timeout and never force-kills', async () => {
    const { deps, calls } = makeDeps()
    await expect(install.quitPilot(deps, 2000)).rejects.toThrow(/still running after 2s/)
    expect(calls.some((c) => c.cmd === 'kill' || c.cmd === 'pkill')).toBe(false)
  })
})

describe('copy, link, register, launch', () => {
  it('copies with ditto into /Applications and fails on a ditto error', () => {
    const ok = makeDeps()
    install.copyApp(ok.deps, 'dist/mac-arm64/Pilot.app')
    expect(ok.calls[0]).toEqual({
      cmd: 'ditto',
      args: ['dist/mac-arm64/Pilot.app', '/Applications/Pilot.app']
    })
    const bad = makeDeps(() => ({ code: 1, stderr: 'nope' }))
    expect(() => install.copyApp(bad.deps, 'x')).toThrow(/nope/)
  })

  it('points ~/.local/bin/pilot at the installed launcher', () => {
    const { deps, calls } = makeDeps()
    install.linkCli(deps)
    expect(calls.at(-1)).toEqual({
      cmd: 'ln',
      args: ['-sfn', '/Applications/Pilot.app/Contents/Resources/bin/pilot', '/h/.local/bin/pilot']
    })
  })

  it('registers with lsregister', () => {
    const { deps, calls } = makeDeps()
    install.registerApp(deps)
    expect(calls[0].cmd).toMatch(/lsregister$/)
    expect(calls[0].args).toEqual(['-f', '/Applications/Pilot.app'])
  })

  it('launches from a cleared environment without ORCA_* variables', () => {
    const { deps, calls } = makeDeps()
    install.launchApp(deps, { USER: 'u', ORCA_USER_DATA_PATH: '/orca', SECRET: 's' })
    const { cmd, args } = calls[0]
    expect(cmd).toBe('env')
    expect(args.slice(0, 1)).toEqual(['-i'])
    expect(args).toContain('USER=u')
    expect(args).toContain('HOME=/h')
    expect(args.join(' ')).not.toMatch(/ORCA|SECRET/)
    expect(args.slice(-2)).toEqual(['/usr/bin/open', '/Applications/Pilot.app'])
  })
})

describe('waitForCli', () => {
  it('polls until the CLI answers ok and returns the automations', async () => {
    let n = 0
    const { deps } = makeDeps(() => (++n < 3 ? { code: 1 } : { stdout: AUTOMATIONS }))
    const list = await install.waitForCli(deps, 60_000, {})
    expect(n).toBe(3)
    expect(install.enabledNames(list)).toEqual(['a', 'c'])
  })

  it('fails with the log path when the CLI never answers', async () => {
    const { deps } = makeDeps(() => ({ stdout: '{"ok":false}' }))
    await expect(install.waitForCli(deps, 3000, {})).rejects.toThrow(
      /Pilot didn't start; see logs at \/h\/Library\/Application Support\/Pilot\/logs/
    )
  })
})

describe('markNoIndex', () => {
  it('writes the Spotlight marker into dist', () => {
    const write = vi.fn()
    const mkdir = vi.fn()
    install.markNoIndex('dist', write, mkdir)
    expect(write).toHaveBeenCalledWith('dist/.metadata_never_index', '')
  })
})

describe('installPilot', () => {
  const opts = { source: 'dist/mac-arm64/Pilot.app', repo: '/repo', parentEnv: {} }
  const respond: Responder = (c) => {
    if (c.cmd === 'pgrep') {
      return { code: 1 }
    }
    if (c.cmd === 'git') {
      return { stdout: 'abc1234\n' }
    }
    return c.cmd === 'env' && c.args.includes('list-yaml') ? { stdout: AUTOMATIONS } : undefined
  }

  it('quits, copies, links, registers, launches, waits, then summarizes', async () => {
    const { deps, calls } = makeDeps(respond)
    const text = await install.installPilot({ ...opts, deps })
    const order = calls.map((c) => c.cmd).filter((c) => c !== 'mkdir')
    expect(order[0]).toBe('pgrep')
    expect(order.slice(1, 4)).toEqual(['ditto', 'ln', expect.stringMatching(/lsregister$/)])
    expect(text).toContain('Build commit: abc1234')
    expect(text).toContain('Installed at: /Applications/Pilot.app')
    expect(text).toContain('Enabled automations (2): a, c')
  })

  it('--no-launch installs but never opens the app', async () => {
    const { deps, calls } = makeDeps(respond)
    const text = await install.installPilot({ ...opts, launch: false, deps })
    expect(text).toContain('not launched')
    expect(calls.some((c) => c.cmd === 'env')).toBe(false)
  })
})
