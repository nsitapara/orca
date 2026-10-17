// @vitest-environment happy-dom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { testStepRow } from '../../shared/run-views/__fixtures__/runs'
import type { StepLog as Log } from '../../shared/visibility-types'
import { byHost, MINI } from '../hosts/__fixtures__/hosts'
import { PilotHostProvider } from '../hosts/PilotHostContext'

const pilotRpc = vi.fn()
vi.mock('../api', () => ({ pilotRpc: (...args: unknown[]) => pilotRpc(...args) }))

import { StepDetail } from './StepDetail'
import { linkLabel, StepLog } from './StepLog'
import { STEP_LOG_POLL_MS } from './use-step-log'

const LOG: Log = {
  source: 'claude',
  reason: null,
  truncatedBefore: 0,
  later: 2,
  entries: [
    {
      kind: 'tool',
      id: 't1',
      at: Date.UTC(2026, 9, 15, 18, 21),
      tool: 'Bash',
      title: '$ glab mr create --fill',
      status: 'ok',
      summary: '1 lines',
      links: ['https://gitlab.com/g/p/-/merge_requests/9']
    },
    {
      kind: 'tool',
      id: 't2',
      at: Date.UTC(2026, 9, 15, 18, 22),
      tool: 'Bash',
      title: '$ false',
      status: 'error',
      summary: 'exit 1 · boom',
      links: []
    },
    { kind: 'text', id: 'm1:0', at: Date.UTC(2026, 9, 15, 18, 23), title: 'Opened !9.' }
  ]
}

function serve(log: unknown = LOG) {
  pilotRpc.mockImplementation(async (method: string) => {
    if (method === 'pilot.runs.log') {
      return log
    }
    if (method === 'pilot.runs.logEntry') {
      return {
        input: 'glab mr create --fill',
        output: 'https://gitlab.com/g/p/-/merge_requests/9',
        inputCut: 0,
        outputCut: 12
      }
    }
    return null
  })
}

describe('StepLog', () => {
  afterEach(() => {
    cleanup()
    pilotRpc.mockReset()
    vi.useRealTimers()
  })

  it("shows each entry's status, title, summary and links, and the later entries it leaves out", async () => {
    serve()
    render(<StepLog runId="r1" step={testStepRow({ idx: 1, status: 'done' })} />)
    expect(await screen.findByText('$ glab mr create --fill')).toBeTruthy()
    expect(screen.getByText('exit 1 · boom')).toBeTruthy()
    expect(screen.getByText('Opened !9.')).toBeTruthy()
    expect(screen.getByRole('link', { name: '!9' }).getAttribute('href')).toBe(
      'https://gitlab.com/g/p/-/merge_requests/9'
    )
    expect(
      screen.getByText("2 later entries from a resumed session aren't this run's")
    ).toBeTruthy()
    expect(pilotRpc).toHaveBeenCalledWith('pilot.runs.log', { runId: 'r1', stepIdx: 1 })
  })

  it("shows a link that isn't http(s) as plain text", async () => {
    const tool = { ...LOG.entries[0], links: ['javascript:alert(1)'] }
    serve({ ...LOG, entries: [tool] })
    render(<StepLog runId="r1" step={testStepRow({ idx: 1, status: 'done' })} />)
    expect(await screen.findByText('link')).toBeTruthy()
    expect(screen.queryByRole('link')).toBeNull()
  })

  it('opens an entry to its full input and output, saying what was cut', async () => {
    serve()
    render(<StepLog runId="r1" step={testStepRow({ idx: 1, status: 'done' })} />)
    fireEvent.click(await screen.findByRole('button', { name: /glab mr create --fill/ }))
    expect(await screen.findByText('Output · first 12 characters not shown')).toBeTruthy()
    expect(pilotRpc).toHaveBeenCalledWith('pilot.runs.logEntry', {
      runId: 'r1',
      stepIdx: 1,
      id: 't1'
    })
  })

  it("reads another machine's step log, and its entries, from that machine", async () => {
    pilotRpc.mockImplementation(
      byHost({
        mini: (method) =>
          method === 'pilot.runs.log'
            ? LOG
            : { input: '', output: 'done', inputCut: 0, outputCut: 0 }
      })
    )
    render(
      <PilotHostProvider host={MINI}>
        <StepLog runId="r1" step={testStepRow({ idx: 1, status: 'done' })} />
      </PilotHostProvider>
    )
    fireEvent.click(await screen.findByRole('button', { name: /glab mr create --fill/ }))
    await waitFor(() =>
      expect(pilotRpc).toHaveBeenCalledWith(
        'pilot.runs.logEntry',
        { runId: 'r1', stepIdx: 1, id: 't1' },
        { target: MINI.target }
      )
    )
    expect(pilotRpc).toHaveBeenCalledWith(
      'pilot.runs.log',
      { runId: 'r1', stepIdx: 1 },
      { target: MINI.target }
    )
  })

  it('says why a step has no log, and treats a malformed answer as still loading', async () => {
    serve({
      source: 'none',
      reason: "Codex logs aren't read yet: Resume opens the session",
      entries: [],
      truncatedBefore: 0,
      later: 0
    })
    render(<StepLog runId="r1" step={testStepRow({ idx: 1, agent: 'codex' })} />)
    expect(
      await screen.findByText("Codex logs aren't read yet: Resume opens the session")
    ).toBeTruthy()
    cleanup()
    serve({ run: {} })
    render(<StepLog runId="r1" step={testStepRow({ idx: 1 })} />)
    expect(await screen.findByText('Loading the log…')).toBeTruthy()
  })

  it('reads the log again every 5 s while the step runs, and not once it is done', async () => {
    vi.useFakeTimers()
    serve()
    render(<StepLog runId="r1" step={testStepRow({ idx: 1, status: 'running' })} />)
    await act(async () => {
      await vi.advanceTimersByTimeAsync(STEP_LOG_POLL_MS)
    })
    expect(pilotRpc.mock.calls.filter((c) => c[0] === 'pilot.runs.log')).toHaveLength(2)
    cleanup()
    pilotRpc.mockClear()
    render(<StepLog runId="r1" step={testStepRow({ idx: 1, status: 'done' })} />)
    await act(async () => {
      await vi.advanceTimersByTimeAsync(STEP_LOG_POLL_MS * 2)
    })
    expect(pilotRpc.mock.calls.filter((c) => c[0] === 'pilot.runs.log')).toHaveLength(1)
  })

  it('keeps the last good log, with the error under it, when a later poll fails', async () => {
    vi.useFakeTimers()
    serve()
    render(<StepLog runId="r1" step={testStepRow({ idx: 1, status: 'running' })} />)
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0)
    })
    expect(screen.getByText('$ false')).toBeTruthy()
    pilotRpc.mockRejectedValue(new Error('rpc down'))
    await act(async () => {
      await vi.advanceTimersByTimeAsync(STEP_LOG_POLL_MS)
    })
    expect(screen.getByText('$ false')).toBeTruthy()
    expect(screen.getByText('rpc down')).toBeTruthy()
  })

  it('keeps Loading for a malformed entry answer, and ignores an answer after the row closes', async () => {
    let answer: (v: unknown) => void = () => {}
    pilotRpc.mockImplementation((method: string) => {
      if (method === 'pilot.runs.log') {
        return Promise.resolve(LOG)
      }
      return new Promise((resolve) => (answer = resolve))
    })
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {})
    render(<StepLog runId="r1" step={testStepRow({ idx: 1, status: 'done' })} />)
    const row = await screen.findByRole('button', { name: /glab mr create --fill/ })
    fireEvent.click(row)
    await act(async () => answer({ nope: 1 }))
    expect(screen.getByText('Loading…')).toBeTruthy()
    fireEvent.click(row)
    await act(async () => answer({ input: '', output: 'late', inputCut: 0, outputCut: 0 }))
    expect(screen.queryByText('late')).toBeNull()
    expect(errors).not.toHaveBeenCalled()
    errors.mockRestore()
  })

  it('shows an agent step in StepDetail with its log, and a shell step without asking for one', async () => {
    serve()
    render(<StepDetail runId="r1" step={testStepRow({ idx: 1, kind: 'agent', status: 'done' })} />)
    expect(await screen.findByText('$ false')).toBeTruthy()
    cleanup()
    pilotRpc.mockClear()
    render(
      <StepDetail
        runId="r1"
        step={testStepRow({ idx: 1, agent: 'shell', kind: 'shell', sessionId: null })}
      />
    )
    expect(pilotRpc.mock.calls.filter((c) => c[0] === 'pilot.runs.log')).toHaveLength(0)
  })
})

describe('linkLabel', () => {
  it.each([
    ['https://gitlab.com/g/p/-/merge_requests/9', '!9'],
    ['https://gitlab.com/g/p/-/pipelines/77', 'pipeline 77'],
    ['https://gitlab.com/g/p/-/jobs/5', 'job 5'],
    ['https://linear.app/acme/issue/WEB-7/slug', 'WEB-7'],
    ['https://example.com/x', 'link']
  ])('%s', (url, label) => {
    expect(linkLabel(url)).toBe(label)
  })
})
