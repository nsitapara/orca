import { describe, expect, it } from 'vitest'
import type { ExecutionHostId } from '../../../../../shared/execution-host'
import type { TuiAgent } from '../../../../../shared/tui-agent'
import {
  agentAvailability,
  buildNewTabMachineRows,
  defaultNewTabMachine,
  highlightedNewTabMachine
} from './new-tab-machine-rows'
import { machineTarget } from './new-tab-machine-test-fixtures'

describe('new tab machine rows', () => {
  it.each([
    [null, 'checking'],
    [['codex'], 'detected'],
    [['claude'], 'missing']
  ] as const)('agentAvailability(%j) is %s', (detected, expected) =>
    expect(agentAvailability(detected, 'codex')).toBe(expected)
  )

  const here = machineTarget('local', 'wt-1', {
    isCurrent: true,
    opensIn: 'this-workspace',
    worktreeName: 'feat',
    machineLabel: 'Local Mac'
  })
  const there = machineTarget('runtime:env-b', 'repo-b::/b/feat', {
    opensIn: 'same-branch',
    worktreeName: 'feat',
    machineLabel: 'Second Mac'
  })
  const box = machineTarget('ssh:box', 'repo-c::/c', {
    opensIn: 'main-checkout',
    worktreeName: 'c',
    machineLabel: 'Build box'
  })
  const rows = (detected: Parameters<typeof buildNewTabMachineRows>[0]['detected'], query = '') =>
    buildNewTabMachineRows({
      targets: [here, there, box],
      detected,
      agent: 'codex',
      agentLabel: 'Codex',
      query
    })

  it('says where each machine opens, and disables a machine without the agent', () => {
    expect(rows([null, ['codex'], ['claude']]).map((r) => [r.detail, r.disabled])).toEqual([
      ['feat · this workspace', false],
      ['feat · same branch', false],
      ['Codex not found here', true]
    ])
  })

  it('keeps a machine whose check is still running pickable', () =>
    expect(rows([null, null, null]).map((r) => r.disabled)).toEqual([false, false, false]))

  it('filters by machine name or where it opens', () => {
    expect(rows([null, null, null], 'build').map((r) => r.hostId)).toEqual(['ssh:box'])
    expect(rows([null, null, null], 'SAME').map((r) => r.hostId)).toEqual(['runtime:env-b'])
  })

  type DefaultCase = {
    name: string
    detected: readonly (readonly TuiAgent[] | null)[]
    last: ExecutionHostId | null
    expected: ExecutionHostId
  }
  const defaultCases: DefaultCase[] = [
    {
      name: 'the last pick when it is listed and enabled',
      detected: [null, ['codex'], null],
      last: 'runtime:env-b',
      expected: 'runtime:env-b'
    },
    {
      name: 'the current machine when the last pick lacks the agent',
      detected: [null, ['claude'], null],
      last: 'runtime:env-b',
      expected: 'local'
    },
    {
      name: 'the current machine when the last pick is not listed',
      detected: [null, null, null],
      last: 'ssh:gone',
      expected: 'local'
    },
    {
      name: 'the current machine with no last pick',
      detected: [null, null, null],
      last: null,
      expected: 'local'
    }
  ]
  it.each(defaultCases)('defaultNewTabMachine picks $name', ({ detected, last, expected }) =>
    expect(defaultNewTabMachine(rows(detected), last)).toBe(expected)
  )

  it('defaultNewTabMachine falls to the first enabled row when the current one is filtered out', () =>
    expect(defaultNewTabMachine(rows([null, ['claude'], null], 'b'), null)).toBe('ssh:box'))

  it.each([
    { selected: 'ssh:box', expected: 'ssh:box' },
    { selected: 'runtime:env-b', expected: 'local' },
    { selected: '', expected: 'local' }
  ])('highlightedNewTabMachine keeps an enabled selection: $selected', ({ selected, expected }) =>
    expect(highlightedNewTabMachine(rows([null, ['claude'], null]), selected, null)).toBe(expected)
  )
})
