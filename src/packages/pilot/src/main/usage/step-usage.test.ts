import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { PilotStore } from '../store/store'
import type { MeasurableStep } from '../store/store-usage'
import type { UsageBucket } from './buckets'
import {
  defaultUsagePaths,
  measureFinishedSteps,
  MEASURE_RETRY_MS,
  stepUsageReader
} from './step-usage'

const bucket = (costUsd: number): UsageBucket => ({
  day: '2026-10-11',
  model: 'claude-opus-5-5',
  requests: 1,
  input: 10,
  cacheRead: 0,
  cacheWrite: 0,
  output: 0,
  costUsd
})

function storeWithFinishedSteps(n: number, finishedAt = 1_000): PilotStore {
  const store = PilotStore.open(join(mkdtempSync(join(tmpdir(), 'pilot-measure-')), 'db.sqlite'))
  store.runs.create({
    id: 'r1',
    automationId: 'a',
    tickId: null,
    itemKey: 'mr:1',
    itemLabel: '!1',
    worktreePath: '/wt',
    startedAt: 1
  })
  for (let idx = 0; idx < n; idx++) {
    store.runs.createStep({
      runId: 'r1',
      idx,
      name: `s${idx}`,
      agent: 'claude',
      skill: null,
      startedAt: 10
    })
    store.runs.updateStep('r1', idx, { status: 'done', finishedAt, sessionId: `sess-${idx}` })
  }
  return store
}

describe('measureFinishedSteps', () => {
  it('reads each finished agent step once and rolls the run up', async () => {
    const store = storeWithFinishedSteps(2)
    const read = vi.fn(async (s: MeasurableStep) => ({
      buckets: [bucket(s.idx + 1)],
      sessionFound: true
    }))
    expect(
      await measureFinishedSteps(
        store,
        read,
        () => 5_000,
        () => {}
      )
    ).toBe(2)
    expect(
      await measureFinishedSteps(
        store,
        read,
        () => 6_000,
        () => {}
      )
    ).toBe(0)
    expect(read).toHaveBeenCalledTimes(2)
    expect(store.runs.get('r1')).toMatchObject({ costUsd: 3, tokens: 20 })
  })

  it('re-rolls the run cost when a step is measured after its run closed', async () => {
    const store = storeWithFinishedSteps(1)
    store.runs.updateStep('r1', 0, { status: 'done', finishedAt: 1_000 })
    store.runs.update('r1', {
      status: 'done',
      finishedAt: 2_000,
      costUsd: null,
      tokens: null
    } as never)
    const read = async () => ({ buckets: [bucket(2)], sessionFound: true })
    await measureFinishedSteps(
      store,
      read,
      () => 5_000,
      () => {}
    )
    expect(store.runs.get('r1')).toMatchObject({ status: 'done', costUsd: 2, tokens: 10 })
  })

  it('waits for a transcript that is not there yet, then records the gap after 10 minutes', async () => {
    const store = storeWithFinishedSteps(1, 1_000)
    const read = async () => ({ buckets: [], sessionFound: false })
    expect(
      await measureFinishedSteps(
        store,
        read,
        () => 1_000 + MEASURE_RETRY_MS - 1,
        () => {}
      )
    ).toBe(0)
    expect(store.usage.unmeasuredSteps()).toHaveLength(1)
    expect(
      await measureFinishedSteps(
        store,
        read,
        () => 1_000 + MEASURE_RETRY_MS,
        () => {}
      )
    ).toBe(1)
    expect(store.usage.unmeasuredSteps()).toEqual([])
  })

  it('a failing read leaves that step for the next poll and still measures the others', async () => {
    const store = storeWithFinishedSteps(2)
    const log = vi.fn()
    const read = async (s: MeasurableStep) => {
      if (s.idx === 0) {
        throw new Error('disk on fire')
      }
      return { buckets: [bucket(1)], sessionFound: true }
    }
    expect(await measureFinishedSteps(store, read, () => 5_000, log)).toBe(1)
    expect(log).toHaveBeenCalledWith("[pilot] couldn't measure step r1/0: disk on fire")
    expect(store.usage.unmeasuredSteps().map((s) => s.idx)).toEqual([0])
  })
})

describe('stepUsageReader', () => {
  const base: MeasurableStep = {
    runId: 'r',
    idx: 0,
    agent: 'claude',
    sessionId: null,
    transcriptPath: null,
    startedAt: 0,
    finishedAt: 10
  }

  it.each([
    ['no session id', { ...base }],
    ['a shell step', { ...base, agent: 'shell', sessionId: 'x' }],
    ['a Claude session whose transcript is nowhere', { ...base, sessionId: 'nope' }],
    ['a Codex session whose rollout is nowhere', { ...base, agent: 'codex', sessionId: 'nope' }]
  ])('%s → no session found', async (_name, step) => {
    const read = stepUsageReader(
      { claudeProjects: '/no/projects', codexHomes: ['/no/codex'] },
      () => 10
    )
    expect(await read(step)).toEqual({ buckets: [], sessionFound: false })
  })

  it('a Claude session found by id counts as found, even with no turns in the window', async () => {
    const projects = mkdtempSync(join(tmpdir(), 'pilot-reader-'))
    mkdirSync(join(projects, 'wt'))
    writeFileSync(join(projects, 'wt', 'sess-1.jsonl'), '')
    const read = stepUsageReader({ claudeProjects: projects, codexHomes: [] }, () => 10)
    expect(await read({ ...base, sessionId: 'sess-1' })).toEqual({
      buckets: [],
      sessionFound: true
    })
  })

  it('defaults to ~/.claude/projects and the Codex homes', () => {
    expect(defaultUsagePaths({}, '/h')).toEqual({
      claudeProjects: '/h/.claude/projects',
      codexHomes: ['/h/.codex']
    })
    expect(defaultUsagePaths({ CLAUDE_CONFIG_DIR: '/c', CODEX_HOME: '/x' }, '/h')).toEqual({
      claudeProjects: '/c/projects',
      codexHomes: ['/x', '/h/.codex']
    })
  })
})
