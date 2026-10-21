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

const isChildList = (c: Call) => c.cmd === 'pgrep' && c.args.includes('-P')

const HELPER =
  '/Applications/Pilot.app/Contents/Frameworks/Pilot Helper.app/Contents/MacOS/Pilot Helper'
const CHILDREN = [
  `201 ${HELPER} --type=gpu-process`,
  `202 ${HELPER} --type=utility`,
  `203 ${HELPER} /Applications/Pilot.app/Contents/Resources/app.asar.unpacked/out/main/daemon-entry.js --socket /s`,
  ''
].join('\n')

describe('quitPilot', () => {
  it('does nothing when Pilot is not running', async () => {
    const { deps, calls } = makeDeps(() => ({ code: 1 }))
    expect(await install.quitPilot(deps)).toBe(false)
    expect(calls.map((c) => c.cmd)).toEqual(['pgrep'])
  })

  // A running Pilot: main pid 100 with helper children 201 and 202, and the terminal daemon 203 it spawned.
  function running(
    opts: { mainGoneAfter?: number; helperAliveChecks?: number; dbHeldChecks?: number } = {}
  ) {
    const n = { main: 0, helper: 0, db: 0 }
    const stub = makeDeps((c) => {
      if (isChildList(c)) {
        return { stdout: CHILDREN }
      }
      if (c.cmd === 'pgrep') {
        return ++n.main <= (opts.mainGoneAfter ?? 3) ? { stdout: '100\n' } : { code: 1 }
      }
      if (c.cmd === 'ps') {
        return { code: ++n.helper <= (opts.helperAliveChecks ?? 0) ? 0 : 1 }
      }
      if (c.cmd === 'lsof') {
        return { stdout: ++n.db <= (opts.dbHeldChecks ?? 0) ? '100\n' : '' }
      }
      return undefined
    })
    return { ...stub, n }
  }

  it('quits by bundle id and waits for the main process to exit', async () => {
    const { deps, calls } = running()
    expect(await install.quitPilot(deps)).toBe(true)
    expect(calls.find((c) => c.cmd === 'osascript')?.args[1]).toContain('dev.nsitapara.pilot')
  })

  it("waits for the old main pid's helpers, found before the quit, never for the terminal daemon", async () => {
    const { deps, calls, n } = running({ helperAliveChecks: 5 })
    await install.quitPilot(deps)
    const psPids = calls.filter((c) => c.cmd === 'ps').map((c) => c.args[1])
    expect(new Set(psPids)).toEqual(new Set(['201', '202']))
    expect(n.helper).toBeGreaterThan(5)
    const order = calls.map((c) => (isChildList(c) ? 'children' : c.cmd))
    expect(order.indexOf('children')).toBeLessThan(order.indexOf('osascript'))
    expect(calls.some((c) => c.cmd === 'pgrep' && c.args.join(' ').includes('Helper'))).toBe(false)
  })

  it('waits until no process holds the automations database, -wal or -shm', async () => {
    const { deps, calls, n } = running({ dbHeldChecks: 4 })
    await install.quitPilot(deps)
    expect(n.db).toBe(5)
    const files = calls.find((c) => c.cmd === 'lsof')?.args.slice(1)
    expect(files).toEqual([
      '/h/Library/Application Support/Pilot/pilot-automations.db',
      '/h/Library/Application Support/Pilot/pilot-automations.db-wal',
      '/h/Library/Application Support/Pilot/pilot-automations.db-shm'
    ])
  })

  it('fails after the timeout and never force-kills', async () => {
    for (const opts of [
      { mainGoneAfter: 1e9 },
      { helperAliveChecks: 1e9 },
      { dbHeldChecks: 1e9 }
    ]) {
      const { deps, calls } = running(opts)
      await expect(install.quitPilot(deps, 2000)).rejects.toThrow(/after 2s/)
      expect(calls.some((c) => c.cmd === 'kill' || c.cmd === 'pkill')).toBe(false)
    }
  })
})

describe('copy, link, register, launch', () => {
  it('replaces the installed bundle through a staged copy, never merging into it', () => {
    const ok = makeDeps()
    install.copyApp(ok.deps, 'dist/mac-arm64/Pilot.app')
    expect(ok.calls).toEqual([
      { cmd: 'rm', args: ['-rf', '/Applications/Pilot.app.installing'] },
      { cmd: 'ditto', args: ['dist/mac-arm64/Pilot.app', '/Applications/Pilot.app.installing'] },
      { cmd: 'rm', args: ['-rf', '/Applications/Pilot.app'] },
      { cmd: 'mv', args: ['/Applications/Pilot.app.installing', '/Applications/Pilot.app'] }
    ])
  })

  it.each([
    ['ditto', (c: Call) => c.cmd === 'ditto'],
    [
      'removing the old app',
      (c: Call) => c.cmd === 'rm' && c.args[1] === '/Applications/Pilot.app'
    ],
    ['mv', (c: Call) => c.cmd === 'mv']
  ])('fails on a %s error and installs nothing after it', (_name, failing) => {
    const bad = makeDeps((c) => (failing(c) ? { code: 1, stderr: 'nope' } : undefined))
    expect(() => install.copyApp(bad.deps, 'x')).toThrow(/nope/)
    const failedAt = bad.calls.findIndex(failing)
    expect(bad.calls).toHaveLength(failedAt + 1)
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

describe('stuckReport', () => {
  it('prints the last startup-stuck event and the recovery steps without killing anything', () => {
    const trace = '{"e":"boot"}\n{"e":"startup stuck in tray"}\n{"e":"x"}\n'
    const { deps, calls } = makeDeps((c) =>
      c.cmd === 'tail' ? { stdout: trace } : c.cmd === 'pgrep' ? { stdout: '777\n' } : undefined
    )
    const text = install.stuckReport(deps)
    expect(calls.find((c) => c.cmd === 'tail')?.args).toEqual([
      '-n',
      '50',
      '/h/Library/Application Support/Pilot/logs/main.trace.ndjson'
    ])
    expect(text).toContain('startup stuck in tray')
    expect(text).toMatch(/sample 777 2[\s\S]*kill -9 777[\s\S]*--no-install/)
    expect(calls.some((c) => c.cmd === 'kill')).toBe(false)
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
    expect(order.slice(1, 7)).toEqual([
      'rm',
      'ditto',
      'rm',
      'mv',
      'ln',
      expect.stringMatching(/lsregister$/)
    ])
    expect(text).toContain('Build commit: abc1234')
    expect(text).toContain('Installed at: /Applications/Pilot.app')
    expect(text).toContain('Enabled automations (2): a, c')
  })

  it('pauses 8s before open after a quit, and appends the stuck report when the CLI never answers', async () => {
    let up = true
    const sleeps: number[] = []
    const stub = makeDeps((c) => {
      if (c.cmd === 'pgrep' && !isChildList(c)) {
        return up ? { stdout: '100\n' } : { code: up ? 0 : 1 }
      }
      if (c.cmd === 'osascript') {
        up = false
      }
      if (c.cmd === 'tail') {
        return { stdout: '{"e":"startup stuck in tray"}\n' }
      }
      return c.cmd === 'env' && c.args.includes('list-yaml') ? { code: 1 } : undefined
    })
    const sleep = stub.deps.sleep
    stub.deps.sleep = async (ms: number) => {
      sleeps.push(ms)
      await sleep(ms)
    }
    await expect(install.installPilot({ ...opts, deps: stub.deps })).rejects.toThrow(
      /Pilot didn't start[\s\S]*startup stuck in tray[\s\S]*kill -9/
    )
    const names = stub.calls.map((c) => c.cmd)
    expect(sleeps).toContain(8000)
    expect(names.indexOf('env')).toBeGreaterThan(names.indexOf('ditto'))
  })

  it('--no-launch installs but never opens the app', async () => {
    const { deps, calls } = makeDeps(respond)
    const text = await install.installPilot({ ...opts, launch: false, deps })
    expect(text).toContain('not launched')
    expect(calls.some((c) => c.cmd === 'env')).toBe(false)
  })
})

describe('MAIN_PROCESS_PATTERN', () => {
  const daemon =
    '/Applications/Pilot.app/Contents/Frameworks/Pilot Helper.app/Contents/MacOS/Pilot Helper ' +
    '/Applications/Pilot.app/Contents/Resources/app.asar.unpacked/out/main/daemon-entry.js ' +
    '--socket /tmp/pilot.sock /Applications/Pilot.app/Contents/MacOS/Pilot'
  const cases: [string, string, boolean][] = [
    ['installed main', '/Applications/Pilot.app/Contents/MacOS/Pilot', true],
    ['installed main with args', '/Applications/Pilot.app/Contents/MacOS/Pilot --flag', true],
    ['dist main', '/r/dist/mac-arm64/Pilot.app/Contents/MacOS/Pilot', true],
    ['terminal daemon with main path as a later argument', daemon, false],
    [
      'helper process',
      '/Applications/Pilot.app/Contents/Frameworks/Pilot Helper.app/Contents/MacOS/Pilot Helper',
      false
    ]
  ]
  it.each(cases)('%s', (_name, commandLine, expected) => {
    expect(new RegExp(install.MAIN_PROCESS_PATTERN).test(commandLine)).toBe(expected)
  })
})
