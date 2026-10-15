import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { PilotStore } from '../store/store'
import { LogReader } from './log-file'
import {
  CODEX_NOT_READ,
  MAX_DETAIL_CHARS,
  NO_TRANSCRIPT,
  NOT_AN_AGENT,
  stepLog,
  stepLogEntry,
  TRANSCRIPT_CHANGED
} from './step-log'
import { lines, result, say, T0, use as toolUse } from './__fixtures__/transcript'

function setup(text: string) {
  const root = mkdtempSync(join(tmpdir(), 'pilot-steplog-'))
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
    worktreePath: null,
    startedAt: T0
  })
  store.runs.createStep({
    runId: 'r1',
    idx: 0,
    name: 'record',
    agent: 'shell',
    skill: null,
    startedAt: T0,
    kind: 'shell'
  })
  store.runs.createStep({
    runId: 'r1',
    idx: 1,
    name: 'fix',
    agent: 'claude',
    skill: 'x',
    startedAt: T0,
    sessionId: 'sess-1'
  })
  store.runs.updateStep('r1', 1, { finishedAt: T0 + 30_000, status: 'done' })
  store.runs.createStep({
    runId: 'r1',
    idx: 2,
    name: 'review',
    agent: 'codex',
    skill: 'y',
    startedAt: T0
  })
  store.runs.createStep({
    runId: 'r1',
    idx: 3,
    name: 'lost',
    agent: 'claude',
    skill: 'z',
    startedAt: T0,
    sessionId: 'nope'
  })
  return { store, file, deps: { store, reader: new LogReader(root), claudeProjects: root } }
}

const TEXT = lines(
  toolUse(1, 't1', 'Bash', { command: 'git push origin web-1', description: 'push it' }),
  result(2, 't1', `${'x'.repeat(MAX_DETAIL_CHARS)}TAIL`),
  say(3, 'm1', 'Pushed.\nAll done'),
  toolUse(40, 't2', 'Bash', { command: 'later' })
)

describe('stepLog', () => {
  it("returns a Claude step's entries inside its window and counts the later ones", async () => {
    const { deps } = setup(TEXT)
    const log = await stepLog(deps, 'r1', 1)
    expect(log).toMatchObject({ source: 'claude', reason: null, truncatedBefore: 0, later: 1 })
    expect(log.entries.map((e) => e.id)).toEqual(['t1', 'm1:0'])
    expect(log.entries[0]).not.toHaveProperty('command')
  })

  it.each([
    [0, NOT_AN_AGENT],
    [2, CODEX_NOT_READ],
    [3, NO_TRANSCRIPT]
  ])('step %i has no log: %s', async (idx, reason) => {
    const { deps } = setup(TEXT)
    expect(await stepLog(deps, 'r1', idx)).toEqual({
      source: 'none',
      reason,
      entries: [],
      truncatedBefore: 0,
      later: 0
    })
  })

  it('gives the no-transcript reason, not a filesystem path, when the file is gone', async () => {
    const { deps, file } = setup(TEXT)
    deps.store.runs.updateStep('r1', 1, { transcriptPath: file })
    rmSync(file)
    const log = await stepLog(deps, 'r1', 1)
    expect(log.reason).toBe(NO_TRANSCRIPT)
  })

  it('throws for a step that does not exist', async () => {
    const { deps } = setup(TEXT)
    await expect(stepLog(deps, 'r1', 9)).rejects.toThrow('No step 9 in run "r1"')
  })
})

describe('stepLogEntry', () => {
  it("returns a tool call's command and its output's tail, saying how much was cut", async () => {
    const { deps } = setup(TEXT)
    const detail = await stepLogEntry(deps, 'r1', 1, 't1')
    expect(detail.input).toBe('git push origin web-1\n\n# push it')
    expect(detail.output.endsWith('TAIL')).toBe(true)
    expect(detail.output.length).toBe(MAX_DETAIL_CHARS)
    expect(detail).toMatchObject({ inputCut: 0, outputCut: 4 })
  })

  it("returns a message's full text", async () => {
    const { deps } = setup(TEXT)
    expect(await stepLogEntry(deps, 'r1', 1, 'm1:0')).toEqual({
      input: '',
      output: 'Pushed.\nAll done',
      inputCut: 0,
      outputCut: 0
    })
  })

  it('refuses an entry outside the window', async () => {
    const { deps } = setup(TEXT)
    await expect(stepLogEntry(deps, 'r1', 1, 't2')).rejects.toThrow(
      'No log entry "t2" in this step'
    )
  })

  it('says the transcript changed when a span no longer holds the record', async () => {
    const { deps } = setup(TEXT)
    await stepLog(deps, 'r1', 1)
    vi.spyOn(deps.reader, 'span').mockResolvedValue('not json')
    await expect(stepLogEntry(deps, 'r1', 1, 't1')).rejects.toThrow(TRANSCRIPT_CHANGED)
  })
})
