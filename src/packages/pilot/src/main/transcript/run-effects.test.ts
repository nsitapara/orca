import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { PilotStore } from '../store/store'
import { LogReader } from './log-file'
import { REMOTE_MISS_MS, RunEffectsReader } from './run-effects'
import { lines, result, T0, use as toolUse } from './__fixtures__/transcript'

function setup(text: string, remote?: () => Promise<string | null>, now = () => T0) {
  const root = mkdtempSync(join(tmpdir(), 'pilot-effects-'))
  mkdirSync(join(root, 'proj'))
  const file = join(root, 'proj', 'sess-1.jsonl')
  writeFileSync(file, text)
  const store = PilotStore.open(':memory:')
  store.runs.create({
    id: 'r1',
    automationId: 'a',
    tickId: null,
    itemKey: 'k',
    itemLabel: 'k',
    worktreePath: '/wt/web-1',
    startedAt: T0
  })
  store.runs.createStep({
    runId: 'r1',
    idx: 0,
    name: 'fix',
    agent: 'claude',
    skill: 'x',
    startedAt: T0,
    sessionId: 'sess-1'
  })
  store.runs.updateStep('r1', 0, { finishedAt: T0 + 30_000, status: 'done' })
  const action = store.actions.start({
    inboxItemId: null,
    runId: 'r1',
    action: 'linear_create',
    args: {},
    digest: 'd',
    phase: 'do',
    dryRun: false,
    startedAt: T0
  })
  store.actions.finish(
    action,
    'done',
    JSON.stringify({ detail: 'created WEB-5', link: 'https://linear.app/acme/issue/WEB-5' }),
    T0 + 1
  )
  const remoteOf = vi.fn(remote ?? (async () => 'git@gitlab.com:g/p.git'))
  const logReader = new LogReader(root)
  const reader = new RunEffectsReader({
    store,
    reader: logReader,
    claudeProjects: root,
    remoteOf,
    now
  })
  return { store, file, reader, remoteOf, logReader }
}

// An ended run whose one Claude step reads the same session, with no catalog action of its own.
function endedRun(store: PilotStore, id: string, worktreePath: string | null = '/wt/web-1'): void {
  store.runs.create({
    id,
    automationId: 'a',
    tickId: null,
    itemKey: id,
    itemLabel: id,
    worktreePath,
    startedAt: T0,
    status: 'done'
  })
  store.runs.createStep({
    runId: id,
    idx: 0,
    name: 'fix',
    agent: 'claude',
    skill: 'x',
    startedAt: T0,
    sessionId: 'sess-1'
  })
  store.runs.updateStep(id, 0, { finishedAt: T0 + 30_000, status: 'done' })
}

function doneAction(store: PilotStore, runId: string, detail: string): void {
  const id = store.actions.start({
    inboxItemId: null,
    runId,
    action: 'push',
    args: {},
    digest: 'd',
    phase: 'do',
    dryRun: false,
    startedAt: T0
  })
  store.actions.finish(id, 'done', JSON.stringify({ detail }), T0 + 2)
}

const TEXT = lines(
  toolUse(1, 't1', 'Bash', { command: 'git push origin web-1' }),
  result(2, 't1', 'ok'),
  toolUse(3, 't2', 'Bash', {
    command: 'cat <<EOF | orca linear comment add WEB-5 --body-file -\nx\nEOF'
  }),
  result(4, 't2', 'true'),
  toolUse(60, 't3', 'Bash', { command: 'glab mr create --fill' }),
  result(61, 't3', 'https://gitlab.com/g/p/-/merge_requests/9')
)

describe('RunEffectsReader', () => {
  it("joins a run's catalog actions and its Claude steps' effects inside their windows, with links", async () => {
    const { reader } = setup(TEXT)
    expect(await reader.forRun('r1')).toEqual([
      {
        kind: 'action',
        target: 'created WEB-5',
        url: 'https://linear.app/acme/issue/WEB-5',
        count: 1,
        stepIdx: null,
        at: T0 + 1
      },
      {
        kind: 'pushed',
        target: 'web-1',
        url: 'https://gitlab.com/g/p/-/tree/web-1',
        count: 1,
        stepIdx: 0,
        at: T0 + 1000
      },
      {
        kind: 'ticket_commented',
        target: 'WEB-5',
        url: 'https://linear.app/acme/issue/WEB-5',
        count: 1,
        stepIdx: 0,
        at: T0 + 3000
      }
    ])
  })

  it("keeps an ended step's effects and its worktree's remote after the first read", async () => {
    const { reader, file, remoteOf } = setup(TEXT)
    await reader.forRun('r1')
    writeFileSync(
      file,
      lines(toolUse(1, 'z', 'Bash', { command: 'git push origin other' }), result(2, 'z', 'ok'))
    )
    expect((await reader.forRun('r1')).map((e) => e.target)).toContain('web-1')
    expect(remoteOf).toHaveBeenCalledTimes(1)
  })

  it('returns [] for a run that does not exist and maps several runs by id', async () => {
    const { reader } = setup(TEXT)
    expect(await reader.forRun('nope')).toEqual([])
    expect(Object.keys(await reader.forRuns(['r1', 'nope']))).toEqual(['r1', 'nope'])
  })

  it('reads the recent Linear URLs once for a batch and answers each distinct id once', async () => {
    const { reader, store } = setup(TEXT)
    store.runs.create({
      id: 'r2',
      automationId: 'a',
      tickId: null,
      itemKey: 'k2',
      itemLabel: 'k2',
      worktreePath: null,
      startedAt: T0
    })
    const spy = vi.spyOn(store.visibility, 'recentLinearUrls')
    expect(Object.keys(await reader.forRuns(['r1', 'r1', 'r2']))).toEqual(['r1', 'r2'])
    expect(spy.mock.calls.length).toBeLessThanOrEqual(1)
  })

  it('asks git again a minute after a miss, not before', async () => {
    const answers = [null, 'git@gitlab.com:g/p.git']
    let now = T0
    const { reader, remoteOf } = setup(
      TEXT,
      async () => answers.shift() ?? null,
      () => now
    )
    const pushedUrl = async () => (await reader.forRun('r1')).find((e) => e.kind === 'pushed')?.url
    expect(await pushedUrl()).toBeNull()
    now += REMOTE_MISS_MS - 1
    expect(await pushedUrl()).toBeNull()
    expect(remoteOf).toHaveBeenCalledTimes(1)
    now += 1
    expect(await pushedUrl()).toBe('https://gitlab.com/g/p/-/tree/web-1')
    expect(remoteOf).toHaveBeenCalledTimes(2)
  })

  it('shares one git call between concurrent reads of a run', async () => {
    const { reader, remoteOf } = setup(TEXT)
    await Promise.all([reader.forRun('r1'), reader.forRun('r1')])
    expect(remoteOf).toHaveBeenCalledTimes(1)
  })

  it('answers a run with no effects without asking git or reading the recent Linear URLs', async () => {
    const { reader, store, remoteOf } = setup(TEXT)
    store.runs.create({
      id: 'quiet',
      automationId: 'a',
      tickId: null,
      itemKey: 'q',
      itemLabel: 'q',
      worktreePath: '/wt/q',
      startedAt: T0,
      status: 'done'
    })
    const recent = vi.spyOn(store.visibility, 'recentLinearUrls')
    expect(await reader.forRun('quiet')).toEqual([])
    expect(remoteOf).not.toHaveBeenCalled()
    expect(recent).not.toHaveBeenCalled()
  })

  it("keeps an ended run's linked effects, reading nothing again until it gains a done action", async () => {
    const { reader, store, logReader } = setup(TEXT)
    endedRun(store, 'r2')
    const read = vi.spyOn(logReader, 'read')
    const recent = vi.fn(() => ['https://linear.app/acme/issue/WEB-1'])
    const first = await reader.forRun('r2', recent)
    expect(first.map((e) => e.url)).toContain('https://linear.app/acme/issue/WEB-5')
    expect(await reader.forRun('r2', recent)).toEqual(first)
    expect(read).toHaveBeenCalledTimes(1)
    expect(recent).toHaveBeenCalledTimes(1)
    doneAction(store, 'r2', 'pushed web-2')
    expect((await reader.forRun('r2', recent)).map((e) => e.target)).toContain('pushed web-2')
    expect(recent).toHaveBeenCalledTimes(2)
  })
})
