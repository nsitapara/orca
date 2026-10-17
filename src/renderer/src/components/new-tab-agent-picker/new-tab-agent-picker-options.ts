import type { AgentCatalogEntry } from '@/lib/agent-catalog'
import {
  agentPickerBlankTerminalMatches,
  searchAgentPickerEntries
} from '@/lib/agent-picker-search'
import type { TuiAgent } from '../../../../shared/tui-agent'

export const BLANK_TERMINAL_OPTION_ID = '__blank-terminal__'

export type NewTabAgentPickerOption =
  | { kind: 'agent'; id: TuiAgent; entry: AgentCatalogEntry; isDefault: boolean }
  | { kind: 'blank'; id: typeof BLANK_TERMINAL_OPTION_ID; isDefault: boolean }

/** `agents` arrive enabled, detected, and default-first (see `orderTabLaunchAgents`). */
export function buildNewTabAgentPickerOptions({
  agents,
  defaultAgent,
  query
}: {
  agents: readonly AgentCatalogEntry[]
  defaultAgent: TuiAgent | 'blank' | null | undefined
  query: string
}): NewTabAgentPickerOption[] {
  const agentOptions: NewTabAgentPickerOption[] = searchAgentPickerEntries(agents, query).map(
    (entry) => ({ kind: 'agent', id: entry.id, entry, isDefault: entry.id === defaultAgent })
  )
  if (!agentPickerBlankTerminalMatches(query)) {
    return agentOptions
  }
  const blank: NewTabAgentPickerOption = {
    kind: 'blank',
    id: BLANK_TERMINAL_OPTION_ID,
    isDefault: defaultAgent === 'blank'
  }
  // Why: a 'blank' default means Enter on an empty query should open a plain shell.
  return blank.isDefault && query.trim() === ''
    ? [blank, ...agentOptions]
    : [...agentOptions, blank]
}
