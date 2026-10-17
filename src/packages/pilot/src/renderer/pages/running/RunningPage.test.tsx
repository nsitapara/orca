// @vitest-environment happy-dom
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { CapacityPayload } from '../../../shared/api-types-capacity'

const pilotRpc = vi.fn()
vi.mock('../../api', () => ({ pilotRpc: (...args: unknown[]) => pilotRpc(...args) }))

import { RunningPage } from './RunningPage'

const GIB = 1024 ** 3

function capacity(over: Partial<CapacityPayload> = {}): CapacityPayload {
  const now = Date.now()
  return {
    limit: 2,
    running: [
      {
        id: 'r1',
        automationId: 'review',
        automationName: '03 Review and fix',
        itemLabel: '!1655 web-2235',
        startedAt: now - 5 * 60_000,
        memoryBytes: 1.5 * GIB,
        peakBytes: 2 * GIB,
        counted: true
      }
    ],
    queued: [
      {
        automationId: 'ci',
        automationName: '05 Fix failed CI',
        itemKey: 'mr:9',
        itemLabel: '!9 web-9',
        queuedAt: now - 3 * 60_000,
        byHand: true
      }
    ],
    memory: { totalBytes: 24 * GIB, availableBytes: 9 * GIB },
    suggestion: { limit: 3, budgetBytes: 6.5 * GIB, perJobBytes: 2 * GIB, measured: true },
    heaviest: { automationId: 'review', automationName: '03 Review and fix', peakBytes: 2 * GIB },
    ...over
  }
}

// The page's poll answers `current`; a change answers what was set.
function serve(current: CapacityPayload): void {
  pilotRpc.mockImplementation(async (method: string, params?: { limit: number | null }) => {
    if (method === 'pilot.capacity.setLimit') {
      return { ...current, limit: params?.limit ?? null }
    }
    return current
  })
}

async function shown(): Promise<void> {
  render(<RunningPage />)
  await act(async () => {})
}

async function click(name: string): Promise<void> {
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name }))
  })
}

afterEach(() => {
  cleanup()
  pilotRpc.mockReset()
})

describe('RunningPage', () => {
  it('lists what runs with its memory and what waits in line, and says how many slots are used', async () => {
    serve(capacity())
    await shown()
    expect(screen.getByText('1 of 2 in use · 1 waiting')).toBeTruthy()
    const running = within(screen.getByRole('region', { name: 'Running now' }))
    expect(running.getByText('03 Review and fix')).toBeTruthy()
    expect(running.getByText('1.5 GB · peak 2.0 GB')).toBeTruthy()
    const waiting = within(screen.getByRole('region', { name: 'Waiting for a slot' }))
    expect(waiting.getByText('05 Fix failed CI')).toBeTruthy()
    expect(waiting.getByText('Run now')).toBeTruthy()
    expect(waiting.getByText('waiting 3m')).toBeTruthy()
    expect(screen.getByRole('status', { name: 'Jobs at once' }).textContent).toBe('2')
  })

  it.each([
    ['More jobs at once', 2, 3],
    ['Fewer jobs at once', 2, 1],
    ['More jobs at once', 10, null],
    ['Fewer jobs at once', null, 10]
  ] as const)('%s from %s sets %s at once', async (button, from, to) => {
    serve(capacity({ limit: from }))
    await shown()
    await click(button)
    expect(pilotRpc).toHaveBeenCalledWith('pilot.capacity.setLimit', { limit: to })
    expect(screen.getByRole('status', { name: 'Jobs at once' }).textContent).toBe(
      to === null ? 'No limit' : String(to)
    )
  })

  it('uses the suggestion, and offers it only while the limit differs', async () => {
    serve(capacity())
    await shown()
    expect(screen.getByText(/The heaviest job, 03 Review and fix, peaked at 2\.0 GB/)).toBeTruthy()
    await click('Use 3')
    expect(pilotRpc).toHaveBeenCalledWith('pilot.capacity.setLimit', { limit: 3 })
    expect(screen.queryByRole('button', { name: 'Use 3' })).toBeNull()
  })

  it('shows why a change was refused and keeps the limit it had', async () => {
    pilotRpc.mockImplementation(async (method: string) => {
      if (method === 'pilot.capacity.setLimit') {
        throw new Error("Pilot isn't running")
      }
      return capacity()
    })
    await shown()
    await click('More jobs at once')
    expect(screen.getByText("Pilot isn't running")).toBeTruthy()
    expect(screen.getByRole('status', { name: 'Jobs at once' }).textContent).toBe('2')
  })

  it('says when nothing runs or waits', async () => {
    serve(capacity({ running: [], queued: [], limit: null }))
    await shown()
    expect(screen.getByText('0 running, no limit')).toBeTruthy()
    expect(screen.getByText('Nothing is running.')).toBeTruthy()
    expect(screen.getByText('Nothing is waiting.')).toBeTruthy()
  })
})
