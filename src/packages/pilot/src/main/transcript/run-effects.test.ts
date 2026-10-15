import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { PilotStore } from '../store/store'
import { LogReader } from './log-file'
import { RunEffectsReader } from './run-effects'
import { lines, result, T0, use as toolUse } from './__fixtures__/transcript'

function setup(text: string, remote?: () => Promise<string | null>) {
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
  const reader = new RunEffectsReader({
    store,
    reader: new LogReader(root),
    claudeProjects: root,
    remoteOf
  })
  return { store, file, reader, remoteOf }
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

  it('asks git again after a miss', async () => {
    const answers = [null, 'git@gitlab.com:g/p.git']
    const { reader, remoteOf } = setup(TEXT, async () => answers.shift() ?? null)
    const pushedUrl = async () => (await reader.forRun('r1')).find((e) => e.kind === 'pushed')?.url
    expect(await pushedUrl()).toBeNull()
    expect(await pushedUrl()).toBe('https://gitlab.com/g/p/-/tree/web-1')
    expect(remoteOf).toHaveBeenCalledTimes(2)
  })

  it('shares one git call between concurrent reads of a run', async () => {
    const { reader, remoteOf } = setup(TEXT)
    await Promise.all([reader.forRun('r1'), reader.forRun('r1')])
    expect(remoteOf).toHaveBeenCalledTimes(1)
  })
})
