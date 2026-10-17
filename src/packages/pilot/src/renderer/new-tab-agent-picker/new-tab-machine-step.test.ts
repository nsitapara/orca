import { describe, expect, it } from 'vitest'
import type { ExecutionHostHealth } from '../../../../../shared/execution-host-registry'
import type { ProjectHostSetupState } from '../../../../../shared/project-types'
import type { Repo } from '../../../../../shared/repo-types'
import type { Worktree } from '../../../../../shared/worktree/types'
import { makeRepo } from '@/components/worktree-jump-palette-test-fixtures'
import { buildNewTabMachineStep, type NewTabMachineStepInput } from './new-tab-machine-step'
import { host, machineWorktree, PROJECT, setup } from './new-tab-machine-test-fixtures'

function repo(id: string, path: string, over: Partial<Repo> = {}): Repo {
  return { ...makeRepo(), id, path, displayName: id, ...over }
}

const remote = { hostId: 'runtime:env-b', runtimeOwnerEnvironmentId: 'env-b' } as const
const localFeat = machineWorktree('repo-a', '/a/feat', { branch: 'refs/heads/feat' })
const localMain = machineWorktree('repo-a', '/a', {
  branch: 'refs/heads/main',
  isMainWorktree: true
})
const remoteMain = machineWorktree('repo-b', '/b', {
  ...remote,
  branch: 'refs/heads/main',
  isMainWorktree: true
})
const remoteFeat = machineWorktree('repo-b', '/b/feat', { ...remote, branch: 'refs/heads/feat' })

const base: NewTabMachineStepInput = {
  activeWorktree: localFeat,
  repos: [repo('repo-a', '/a'), repo('repo-b', '/b', { connectionId: null })],
  projectHostSetups: [setup('repo-a', 'local'), setup('repo-b', 'runtime:env-b')],
  hosts: [host('local', 'Local Mac', 'local'), host('runtime:env-b', 'Second Mac', 'available')],
  worktreesByRepo: { 'repo-a': [localMain, localFeat], 'repo-b': [remoteMain, remoteFeat] }
}

const summary = (i: NewTabMachineStepInput) =>
  buildNewTabMachineStep(i)?.targets.map((t) => `${t.hostId} ${t.opensIn} ${t.worktreeId}`) ?? null

const remoteWorktrees = (rows: Worktree[]): NewTabMachineStepInput => ({
  ...base,
  worktreesByRepo: { ...base.worktreesByRepo, 'repo-b': rows }
})
const withRemoteHealth = (health: ExecutionHostHealth): NewTabMachineStepInput => ({
  ...base,
  hosts: [host('local', 'Local Mac', 'local'), host('runtime:env-b', 'Second Mac', health)]
})
const remoteSetupState = (setupState: ProjectHostSetupState): NewTabMachineStepInput => ({
  ...base,
  projectHostSetups: [setup('repo-a', 'local'), setup('repo-b', 'runtime:env-b', { setupState })]
})
const remoteRowsHostId = (hostId: 'ssh:hub-box'): NewTabMachineStepInput =>
  remoteWorktrees([
    { ...remoteMain, hostId },
    { ...remoteFeat, hostId }
  ])

const withoutRemoteFeat = remoteWorktrees([remoteMain])
const mainCheckoutOnRemote = [
  'local this-workspace repo-a::/a/feat',
  'runtime:env-b main-checkout repo-b::/b'
]

describe('buildNewTabMachineStep', () => {
  it('names the project and each machine', () => {
    const step = buildNewTabMachineStep(base)
    expect(step?.projectId).toBe(PROJECT)
    expect(step?.targets.map((t) => [t.machineLabel, t.isCurrent])).toEqual([
      ['Local Mac', true],
      ['Second Mac', false]
    ])
  })

  it.each([
    {
      name: 'same branch on the other machine',
      input: base,
      expected: [
        'local this-workspace repo-a::/a/feat',
        'runtime:env-b same-branch repo-b::/b/feat'
      ]
    },
    {
      name: 'no such branch there opens its main checkout',
      input: withoutRemoteFeat,
      expected: mainCheckoutOnRemote
    },
    {
      name: 'an archived same-branch worktree is skipped',
      input: remoteWorktrees([remoteMain, { ...remoteFeat, isArchived: true }]),
      expected: mainCheckoutOnRemote
    },
    ...(['connecting', 'disconnected', 'error', 'blocked'] as const).map((health) => ({
      name: `a ${health} machine is not listed`,
      input: withRemoteHealth(health),
      expected: null
    })),
    {
      name: 'a machine without the project is not listed',
      input: { ...base, projectHostSetups: [setup('repo-a', 'local')] },
      expected: null
    },
    {
      name: 'a machine where the project needs setup is not listed',
      input: remoteSetupState('not-set-up'),
      expected: null
    },
    {
      name: 'a machine with no openable worktree loaded is not listed',
      input: remoteWorktrees([]),
      expected: null
    },
    {
      name: 'a folder workspace has no machine step',
      input: { ...base, activeWorktree: { ...localFeat, id: 'folder:abc' } },
      expected: null
    },
    {
      name: 'a repo without a remote has no machine step',
      input: {
        ...base,
        projectHostSetups: [
          setup('repo-a', 'local', { projectId: 'repo:repo-a' }),
          setup('repo-b', 'runtime:env-b', { projectId: 'repo:repo-a' })
        ]
      },
      expected: null
    },
    {
      name: 'a connected SSH machine is listed',
      input: {
        ...base,
        repos: [repo('repo-a', '/a'), repo('repo-c', '/c')],
        projectHostSetups: [setup('repo-a', 'local'), setup('repo-c', 'ssh:box')],
        hosts: [host('local', 'Local Mac', 'local'), host('ssh:box', 'Box', 'available')],
        worktreesByRepo: {
          'repo-a': [localMain, localFeat],
          'repo-c': [
            machineWorktree('repo-c', '/c/feat', { hostId: 'ssh:box', branch: 'refs/heads/feat' })
          ]
        }
      },
      expected: ['local this-workspace repo-a::/a/feat', 'ssh:box same-branch repo-c::/c/feat']
    },
    {
      name: 'an unstamped local worktree counts as Local from a remote workspace',
      input: { ...base, activeWorktree: remoteFeat },
      expected: [
        'local same-branch repo-a::/a/feat',
        'runtime:env-b this-workspace repo-b::/b/feat'
      ]
    },
    {
      name: "a hub-routed SSH worktree belongs to its server's machine",
      input: remoteRowsHostId('ssh:hub-box'),
      expected: [
        'local this-workspace repo-a::/a/feat',
        'runtime:env-b same-branch repo-b::/b/feat'
      ]
    },
    {
      name: "a detached current worktree opens the other machine's main checkout",
      input: { ...base, activeWorktree: { ...localFeat, branch: '' } },
      expected: mainCheckoutOnRemote
    }
  ])('$name', ({ input, expected }) => expect(summary(input)).toEqual(expected))
})
