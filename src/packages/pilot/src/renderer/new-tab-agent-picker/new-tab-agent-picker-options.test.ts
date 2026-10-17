import { describe, expect, it } from 'vitest'
import type { AgentCatalogEntry } from '@/lib/agent-catalog'
import type { TuiAgent } from '../../../../../shared/tui-agent'
import { buildNewTabAgentPickerOptions } from './new-tab-agent-picker-options'

function entry(id: TuiAgent, label: string, cmd: string): AgentCatalogEntry {
  return { id, label, cmd, homepageUrl: `https://example.com/${id}` }
}

// Default-first, as orderTabLaunchAgents hands them over.
const agents = [entry('claude', 'Claude', 'claude'), entry('codex', 'Codex', 'codex')]

describe('buildNewTabAgentPickerOptions', () => {
  it.each([
    {
      name: 'empty query keeps the default agent first and ends with a blank terminal',
      defaultAgent: 'claude' as const,
      query: '',
      expected: ['claude*', 'codex', '__blank-terminal__']
    },
    {
      name: 'a blank default leads the list on an empty query',
      defaultAgent: 'blank' as const,
      query: '',
      expected: ['__blank-terminal__*', 'claude', 'codex']
    },
    {
      name: 'typing filters to matching agents',
      defaultAgent: 'claude' as const,
      query: 'cod',
      expected: ['codex']
    },
    {
      name: 'typing a shell word offers only the blank terminal',
      defaultAgent: 'claude' as const,
      query: 'term',
      expected: ['__blank-terminal__']
    },
    {
      name: 'a query matching nothing yields no options',
      defaultAgent: 'claude' as const,
      query: 'zzz',
      expected: []
    }
  ])('$name', ({ defaultAgent, query, expected }) => {
    const options = buildNewTabAgentPickerOptions({ agents, defaultAgent, query })
    expect(options.map((option) => `${option.id}${option.isDefault ? '*' : ''}`)).toEqual(expected)
  })
})
