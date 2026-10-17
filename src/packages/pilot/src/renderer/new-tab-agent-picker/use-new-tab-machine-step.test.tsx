// @vitest-environment happy-dom
import { act } from 'react'
import { cleanup, renderHook } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { getDefaultSettings } from '../../../../../shared/constants'
import type { Repo } from '../../../../../shared/repo-types'
import { useAppStore } from '@/store'
import { PROJECT, machineWorktree, setup } from './new-tab-machine-test-fixtures'
import { useNewTabMachineStep } from './use-new-tab-machine-step'

const ensure = vi.hoisted(() => vi.fn((..._args: unknown[]) => Promise.resolve([])))
vi.mock('@/lib/agent-detection-target-inventory', () => ({
  ensureDetectedAgentsForWorktree: ensure
}))

const ACTIVE = 'repo-a::/a/feat'

function repo(id: string, over: Partial<Repo> = {}): Repo {
  return { id, path: `/${id}`, displayName: id, badgeColor: '#000', addedAt: 0, ...over }
}

function seed(status: 'connected' | 'disconnected'): void {
  useAppStore.setState({
    settings: getDefaultSettings('/home'),
    repos: [repo('repo-a'), repo('repo-c', { executionHostId: 'ssh:box' })],
    projectHostSetups: [setup('repo-a', 'local'), setup('repo-c', 'ssh:box')],
    worktreesByRepo: {
      'repo-a': [machineWorktree('repo-a', '/a/feat', { branch: 'feat', projectId: PROJECT })],
      'repo-c': [machineWorktree('repo-c', '/c/feat', { branch: 'feat', hostId: 'ssh:box' })]
    },
    activeWorktreeId: ACTIVE,
    activeWorkspaceExecutionHostId: null,
    sshTargetLabels: new Map([['box', 'Build box']]),
    sshConnectionStates: new Map([
      ['box', { targetId: 'box', status, error: null, reconnectAttempt: 0 }]
    ])
  })
}

afterEach(() => {
  cleanup()
  ensure.mockClear()
})

describe('useNewTabMachineStep', () => {
  it.each([
    { status: 'connected', enabled: true, expected: ['local', 'ssh:box'] },
    { status: 'disconnected', enabled: true, expected: null },
    { status: 'connected', enabled: false, expected: null }
  ] as const)('$status, enabled=$enabled → $expected', ({ status, enabled, expected }) => {
    seed(status)
    const { result } = renderHook(() => useNewTabMachineStep(ACTIVE, enabled))
    expect(result.current?.targets.map((t) => t.hostId) ?? null).toEqual(expected)
  })

  it("warms each other machine's agent list once per open", () => {
    seed('connected')
    const { rerender } = renderHook(() => useNewTabMachineStep(ACTIVE, true))
    act(() =>
      useAppStore.setState({ worktreesByRepo: { ...useAppStore.getState().worktreesByRepo } })
    )
    rerender()
    expect(ensure.mock.calls.map(([, id]) => id)).toEqual(['repo-c::/c/feat'])
  })
})
