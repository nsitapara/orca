// @vitest-environment happy-dom
import { act, cleanup, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { MergeBackRow } from '../../../shared/api-types-capacity'
import { resetPilotHostsFeed } from '../../hosts/pilot-hosts-feed'
import { capacity } from './__fixtures__/capacity'

const pilotRpc = vi.fn()
vi.mock('../../api', () => ({ pilotRpc: (...args: unknown[]) => pilotRpc(...args) }))

import { RunningPage } from './RunningPage'

afterEach(() => {
  cleanup()
  pilotRpc.mockReset()
  resetPilotHostsFeed()
})

const row = (over: Partial<MergeBackRow> = {}): MergeBackRow => ({
  runId: 'r1',
  automationName: '03 · Review and fix',
  itemLabel: 'web-2219',
  branch: 'pilot/r1',
  home: '/wt/web-2219',
  since: Date.now() - 5 * 60_000,
  state: 'not_reached',
  detail: 'Waiting in line: the merge changes 1 file you have local changes in: a.ts',
  mergeRunId: null,
  ...over
})

async function mergeBack(rows: MergeBackRow[] | undefined) {
  pilotRpc.mockResolvedValue(capacity({ mergeBack: rows }))
  render(<RunningPage />)
  await act(async () => {})
  return within(screen.getByRole('region', { name: 'Merge back' }))
}

describe('Merge back on Running', () => {
  it.each<[string, MergeBackRow[] | undefined]>([
    ['none waiting', []],
    ['an older Pilot that sends none', undefined]
  ])('says every fix is home with %s', async (_name, rows) => {
    const region = await mergeBack(rows)
    expect(region.getByText('Every fix made in a throwaway is in its worktree.')).toBeTruthy()
  })

  it('shows each fix: its job, where it stands, the branch and worktree, and what job 15 says now', async () => {
    const region = await mergeBack([row()])
    expect(region.getByText('03 · Review and fix')).toBeTruthy()
    expect(region.getByText('Queued')).toBeTruthy()
    expect(region.getByText('pilot/r1 → web-2219 · web-2219')).toBeTruthy()
    expect(
      region.getByText('Waiting in line: the merge changes 1 file you have local changes in: a.ts')
    ).toBeTruthy()
    expect(region.getByRole('button', { name: 'Open run' })).toBeTruthy()
    expect(region.queryByRole('button', { name: 'Open merge' })).toBeNull()
  })

  it.each<[MergeBackRow['state'], string]>([
    ['running', 'Merging'],
    ['failed', 'Failed'],
    ['done', 'Merged']
  ])('names a %s merge back %s and links its run', async (state, word) => {
    const region = await mergeBack([row({ state, mergeRunId: 'm1' })])
    expect(region.getByText(word)).toBeTruthy()
    expect(region.getByRole('button', { name: 'Open merge' })).toBeTruthy()
  })
})
