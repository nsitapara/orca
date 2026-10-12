import { describe, expect, it, vi } from 'vitest'
import type { CheckDef } from '../../shared/definition/types'
import type { Item } from '../sources/types'
import { addActivityFacts, type ActivityRuntime } from './activity-facts'
import type { BusyTerminal } from './worktree-busy'

const item = (key: string, path: string | null): Item => ({
  kind: 'worktree',
  key,
  label: key,
  fields: path ? { 'worktree.path': path } : {},
  worktreeHint: null,
  sortKeys: { waitingSince: null, priority: null }
})
const tab = (handle: string, path: string): BusyTerminal => ({
  handle,
  title: handle,
  connected: true,
  agentIdentity: 'claude',
  worktreePath: path,
  tabId: handle,
  leafId: 'l'
})

function runtime(
  over: Partial<ActivityRuntime> = {}
): ActivityRuntime & { terminals: ReturnType<typeof vi.fn> } {
  return {
    terminals: vi.fn(async () => [tab('busy', '/wt/a'), tab('quiet', '/wt/b')]),
    reads: () => ({
      draft: async (h: string) => (h === 'busy' ? 'typing…' : ''),
      agentStates: async () => new Map(),
      tabBusy: async () => false
    }),
    terminalAlive: async () => false,
    ...over
  } as ActivityRuntime & { terminals: ReturnType<typeof vi.fn> }
}

const IDLE: CheckDef[] = [{ kind: 'worktree_idle' }]

describe('addActivityFacts', () => {
  it('does nothing, and reads nothing, without a worktree: idle check', async () => {
    const rt = runtime()
    const items = [item('a', '/wt/a')]
    const checks: CheckDef[] = [
      { kind: 'session_none_open', scope: 'any' },
      { kind: 'worktree_exists' }
    ]
    const got = await addActivityFacts(items, checks, rt)
    expect(got.items).toBe(items)
    expect(rt.terminals).not.toHaveBeenCalled()
  })

  it('sets worktree.busy per worktree, read once per path', async () => {
    const rt = runtime()
    const got = await addActivityFacts(
      [item('a', '/wt/a'), item('a2', '/wt/a'), item('b', '/wt/b'), item('n', null)],
      IDLE,
      rt
    )
    expect(got.items.map((i) => i.fields['worktree.busy'])).toEqual([
      'someone is typing in busy',
      'someone is typing in busy',
      '',
      undefined
    ])
    expect(rt.terminals).toHaveBeenCalledTimes(1)
  })

  it("reads only the in-scope items' worktrees, and leaves a missing answer absent", async () => {
    const rt = runtime()
    const draft = vi.fn(async () => '')
    rt.reads = () => ({ draft, agentStates: async () => new Map(), tabBusy: async () => false })
    const got = await addActivityFacts(
      [item('a', '/wt/a'), item('b', '/wt/b')],
      IDLE,
      rt,
      (i) => i.key === 'b'
    )
    expect(got.items.map((i) => i.fields['worktree.busy'])).toEqual([undefined, ''])
    expect(draft).toHaveBeenCalledTimes(1)
  })

  it('fails closed when the terminals cannot be listed', async () => {
    const rt = runtime({
      terminals: vi.fn(async () => {
        throw new Error('runtime_unavailable')
      })
    })
    const got = await addActivityFacts([item('a', '/wt/a')], IDLE, rt)
    expect(got.items[0].fields['worktree.busy']).toBe(
      "the terminals couldn't be listed: runtime_unavailable"
    )
    expect(got.warnings).toEqual(["the terminals couldn't be listed: runtime_unavailable"])
  })
})
