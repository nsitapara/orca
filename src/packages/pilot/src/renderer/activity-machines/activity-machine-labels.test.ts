import { describe, expect, it } from 'vitest'
import type { ExecutionHostId } from '../../../../../shared/execution-host'
import {
  buildActivityMachineLabels,
  type ActivityMachineHost,
  type ActivityMachineRow
} from './activity-machine-labels'

const HOSTS: ActivityMachineHost[] = [
  { id: 'local', label: 'Local Mac' },
  { id: 'runtime:mini', label: 'Mac mini' },
  { id: 'runtime:twin', label: 'Mac mini' },
  { id: 'ssh:box', label: 'box', aliasHostIds: ['runtime:box-orcad'] },
  { id: 'runtime:box-orcad', label: 'box', mergedIntoHostId: 'ssh:box' }
]

const row = (hostId?: ExecutionHostId, repoHostId?: ExecutionHostId): ActivityMachineRow => ({
  worktree: { hostId },
  repo: repoHostId ? { connectionId: null, executionHostId: repoHostId } : null
})

type Case = {
  name: string
  rows: ActivityMachineRow[]
  defaultHostId?: ExecutionHostId
  expected: Record<string, string> | null
}

describe('buildActivityMachineLabels', () => {
  const cases: Case[] = [
    { name: 'one machine', rows: [row('local'), row('local')], expected: null },
    { name: 'no rows', rows: [], expected: null },
    {
      name: 'two machines',
      rows: [row('local'), row('runtime:mini')],
      expected: { local: 'Local Mac', 'runtime:mini': 'Mac mini' }
    },
    {
      name: 'the repo names the host when the workspace does not',
      rows: [row(undefined, 'runtime:mini'), row('local')],
      expected: { 'runtime:mini': 'Mac mini', local: 'Local Mac' }
    },
    {
      name: 'a hostless row falls back to the focused host',
      rows: [row(), row('runtime:mini')],
      defaultHostId: 'runtime:mini',
      expected: null
    },
    {
      name: 'machines sharing a label still differ',
      rows: [row('runtime:mini'), row('runtime:twin')],
      expected: { 'runtime:mini': 'Mac mini', 'runtime:twin': 'Mac mini' }
    },
    {
      name: 'an SSH host and its managed server are one machine',
      rows: [row('ssh:box'), row('runtime:box-orcad')],
      expected: null
    },
    {
      name: 'a merged-away id is named after its machine',
      rows: [row('runtime:box-orcad'), row('local')],
      expected: { 'runtime:box-orcad': 'box', local: 'Local Mac' }
    },
    {
      name: 'a host the registry lacks is named by its id',
      rows: [row('runtime:gone'), row('local')],
      expected: { 'runtime:gone': 'gone', local: 'Local Mac' }
    }
  ]
  it.each(cases)('$name', ({ rows, defaultHostId = 'local', expected }) => {
    const labels = buildActivityMachineLabels({ rows, defaultHostId, hosts: HOSTS })
    expect(labels ? Object.fromEntries(labels) : null).toEqual(expected)
  })
})
