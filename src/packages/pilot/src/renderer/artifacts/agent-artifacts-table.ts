import type { ArtifactsListTab } from './artifacts-page-rows'

// Column templates for each tab; the table chrome is upstream's (@/lib/list-table-layout).
export const AGENT_ARTIFACTS_GRID: Record<ArtifactsListTab, string> = {
  // Name | Tickets | Built by | Versions | Updated | open, copy
  agents:
    'grid min-w-[52rem] grid-cols-[minmax(16rem,2.2fr)_minmax(7rem,1fr)_minmax(10rem,1.2fr)_4.5rem_6.5rem_4.5rem]',
  // Report | Ticket | Made by | Updated | open, copy
  local:
    'grid min-w-[44rem] grid-cols-[minmax(16rem,2.2fr)_minmax(6rem,0.8fr)_minmax(10rem,1.4fr)_6.5rem_4.5rem]',
  // Name | Updated | open, copy
  untracked: 'grid min-w-[30rem] grid-cols-[minmax(16rem,1fr)_6.5rem_4.5rem]'
}

export const AGENT_ARTIFACTS_HEADERS: Record<ArtifactsListTab, readonly string[]> = {
  agents: ['Name', 'Tickets', 'Built by', 'Versions', 'Updated'],
  local: ['Report', 'Ticket', 'Made by', 'Updated'],
  untracked: ['Name', 'Updated']
}

// Two lines of text (title and description) in a py-3 row, plus its 1px divider.
export const AGENT_ARTIFACTS_ROW_HEIGHT_PX = 63
