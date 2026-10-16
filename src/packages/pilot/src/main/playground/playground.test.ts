import { describe, expect, it } from 'vitest'
import { playgroundService, type PlaygroundChild, type PlaygroundDeps } from './playground'

const ADDRESS = 'http://127.0.0.1:4567/?token=abc123'
// Lets start's project check finish, so the child is spawned and listened to.
const tick = () => new Promise((r) => setTimeout(r, 0))
const READY = `pilotcli playground: ${ADDRESS} (Ctrl-C stops it)`

// A child the test drives: it records the signals it got, and says lines and exits when told.
function fakeChild() {
  let line: (text: string) => void = () => {}
  let exit: (code: number | null) => void = () => {}
  const signals: string[] = []
  const child: PlaygroundChild = {
    onLine: (l) => (line = l),
    onExit: (e) => (exit = e),
    signal: (s) => signals.push(s)
  }
  return {
    child,
    signals,
    say: (text: string) => line(text),
    exit: (code: number | null) => exit(code)
  }
}

function world(over: Partial<PlaygroundDeps> = {}) {
  const fake = fakeChild()
  const spawned: string[] = []
  const deps: PlaygroundDeps = {
    repos: () => [
      { path: '/r/web', displayName: 'web-platform' },
      { path: '/r/dotfiles', displayName: 'dotfiles' }
    ],
    projectOf: async (path) => (path === '/r/web' ? 'web-platform' : null),
    spawn: (path) => {
      spawned.push(path)
      return fake.child
    },
    startTimeoutMs: 1000,
    ...over
  }
  return { service: playgroundService(deps), fake, spawned }
}

describe('playground projects', () => {
  it('lists only the repos pilotcli knows, with their project', async () => {
    const { service } = world()
    expect(await service.projects()).toEqual([
      { path: '/r/web', name: 'web-platform', project: 'web-platform' }
    ])
  })
})

describe('starting the playground', () => {
  it('is running once the address line appears', async () => {
    const { service, fake, spawned } = world()
    const started = service.start('/r/web')
    expect(service.status()).toEqual({ state: 'starting', repoPath: '/r/web' })
    await tick()
    fake.say('some other line')
    fake.say(READY)
    expect(await started).toEqual({ state: 'running', repoPath: '/r/web', url: ADDRESS })
    expect(spawned).toEqual(['/r/web'])
  })

  it('refuses a repo pilotcli does not know, without spawning', async () => {
    const { service, spawned } = world()
    await expect(service.start('/r/dotfiles')).rejects.toThrow(
      "/r/dotfiles isn't a project pilotcli knows"
    )
    expect(spawned).toEqual([])
  })

  it.each([
    [
      'it exits before its address',
      (f: ReturnType<typeof fakeChild>) => {
        f.say('no configured project here; run it in a worktree, or pass --project')
        f.exit(2)
      },
      'pilotcli playground exited (exit 2): no configured project here; run it in a worktree, or pass --project'
    ],
    ['it never says its address', () => {}, "pilotcli playground didn't start within 0.05s"]
  ])('is stopped with the reason when %s', async (_name, act, reason) => {
    const { service, fake } = world({ startTimeoutMs: 50 })
    const started = service.start('/r/web')
    await tick()
    act(fake)
    expect(await started).toEqual({ state: 'stopped', repoPath: '/r/web', reason })
    expect(service.status()).toEqual({ state: 'stopped', repoPath: '/r/web', reason })
  })

  it('says why it could not spawn', async () => {
    const { service } = world({ spawn: () => ({ error: "pilotcli isn't installed" }) })
    expect(await service.start('/r/web')).toEqual({
      state: 'stopped',
      repoPath: '/r/web',
      reason: "pilotcli isn't installed"
    })
  })

  it('keeps one playground: the same project again is the one running, another is refused', async () => {
    const { service, fake } = world({
      projectOf: async (path) => (path.startsWith('/r/') ? 'p' : null)
    })
    const started = service.start('/r/web')
    await tick()
    fake.say(READY)
    await started
    expect(await service.start('/r/web')).toEqual({
      state: 'running',
      repoPath: '/r/web',
      url: ADDRESS
    })
    await expect(service.start('/r/dotfiles')).rejects.toThrow(
      'Stop the playground for /r/web first'
    )
  })
})

describe('stopping the playground', () => {
  async function running() {
    const w = world()
    const started = w.service.start('/r/web')
    await tick()
    w.fake.say(READY)
    await started
    return w
  }

  it('stops its process group, and is stopped without a reason once it exits', async () => {
    const { service, fake } = await running()
    const stopping = service.stop()
    expect(fake.signals).toEqual(['SIGTERM'])
    fake.exit(0)
    expect(await stopping).toEqual({ state: 'stopped', repoPath: '/r/web', reason: null })
  })

  it("is stopped without a reason when the page's Stop ends it", async () => {
    const { service, fake } = await running()
    fake.exit(0)
    expect(service.status()).toEqual({ state: 'stopped', repoPath: '/r/web', reason: null })
  })

  it('kills a playground that outlives its stop', async () => {
    const { service, fake } = await running()
    const stopping = service.stop(20)
    await new Promise((r) => setTimeout(r, 60))
    expect(fake.signals).toEqual(['SIGTERM', 'SIGKILL'])
    fake.exit(null)
    expect(await stopping).toEqual({ state: 'stopped', repoPath: '/r/web', reason: null })
  })

  it('stops it when Pilot quits', async () => {
    const { service, fake } = await running()
    service.close()
    expect(fake.signals).toEqual(['SIGTERM'])
  })

  it('does nothing when none runs', async () => {
    const { service, fake } = world()
    expect(await service.stop()).toEqual({ state: 'stopped', repoPath: null, reason: null })
    service.close()
    expect(fake.signals).toEqual([])
  })
})
