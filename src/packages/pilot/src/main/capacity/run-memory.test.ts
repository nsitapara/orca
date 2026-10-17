import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { PilotStore } from '../store/store'
import type { ProcessRow } from './process-tree-memory'
import { RunMemorySampler } from './run-memory'
import { terminalRootPid } from './terminal-root-pid'

const SYSTEM = { totalBytes: 24, availableBytes: 10 }

function setup(table: ProcessRow[] | null) {
  const store = PilotStore.open(join(mkdtempSync(join(tmpdir(), 'pilot-run-memory-')), 'db.sqlite'))
  const run = (id: string, steps: { kind: 'agent' | 'shell'; handle: string | null }[]) => {
    store.runs.create({
      id,
      automationId: 'a',
      tickId: null,
      itemKey: id,
      itemLabel: id,
      worktreePath: null,
      startedAt: 1
    })
    steps.forEach((step, idx) => {
      store.runs.createStep({
        runId: id,
        idx,
        name: `s${idx}`,
        agent: step.kind === 'agent' ? 'claude' : 'shell',
        skill: null,
        startedAt: 1,
        kind: step.kind,
        status: 'running'
      })
      if (step.handle !== null) {
        store.runs.updateStep(id, idx, { terminalHandle: step.handle })
      }
    })
  }
  const roots: Record<string, number> = { 'term-a': 10, 'term-b': 20 }
  let tableReads = 0
  const sampler = new RunMemorySampler({
    store,
    now: () => 500,
    rootPid: async (step) => (step.terminalHandle ? (roots[step.terminalHandle] ?? null) : null),
    readProcesses: async () => {
      tableReads += 1
      return table
    },
    readSystem: async () => SYSTEM
  })
  return { store, run, sampler, reads: () => tableReads }
}

const TABLE: ProcessRow[] = [
  { pid: 10, ppid: 1, rssBytes: 100 },
  { pid: 11, ppid: 10, rssBytes: 900 },
  { pid: 20, ppid: 1, rssBytes: 50 }
]

describe('RunMemorySampler', () => {
  it("measures each running run's agent terminals, keeps the peak, and skips shell steps", async () => {
    const { store, run, sampler } = setup(TABLE)
    run('r1', [{ kind: 'agent', handle: 'term-a' }])
    run('r2', [
      { kind: 'shell', handle: 'term-b' },
      { kind: 'agent', handle: 'term-gone' }
    ])
    await sampler.sample()
    expect(sampler.snapshot()).toEqual({
      runs: new Map([['r1', 1000]]),
      system: SYSTEM,
      sampledAt: 500
    })
    expect(store.capacity.peaks(['r1', 'r2'])).toEqual(new Map([['r1', 1000]]))
  })

  it('reads no process table while no agent runs', async () => {
    const { run, sampler, reads } = setup(TABLE)
    run('r1', [{ kind: 'shell', handle: 'term-b' }])
    await sampler.sample()
    expect(reads()).toBe(0)
    expect(sampler.snapshot().system).toEqual(SYSTEM)
  })

  it('keeps the system figures but measures no run when processes cannot be read', async () => {
    const { run, sampler } = setup(null)
    run('r1', [{ kind: 'agent', handle: 'term-a' }])
    await sampler.sample()
    expect(sampler.snapshot()).toEqual({ runs: new Map(), system: SYSTEM, sampledAt: 500 })
  })
})

describe('terminalRootPid', () => {
  const step = (terminalHandle: string | null) => ({ terminalHandle })
  const rootOf = terminalRootPid({
    ptyIdOf: async (handle) => {
      if (handle === 'gone') {
        throw new Error('terminal not found')
      }
      return handle === 'remote' ? null : `pty-${handle}`
    },
    listPtys: () => [
      { ptyId: 'pty-t1', pid: 4242 },
      { ptyId: 'pty-t2', pid: null }
    ]
  })

  it.each([
    ['a registered local terminal', 't1', 4242],
    ['a PTY whose pid was never published', 't2', null],
    ['a terminal the runtime no longer has', 'gone', null],
    ['a terminal with no local PTY', 'remote', null],
    ['a step with no terminal', null, null]
  ])('finds the root pid of %s', async (_name, handle, expected) => {
    expect(await rootOf(step(handle))).toBe(expected)
  })
})
