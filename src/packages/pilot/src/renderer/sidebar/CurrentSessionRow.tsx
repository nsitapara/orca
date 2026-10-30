import { AgentStateDot, agentStateLabel } from '@/components/AgentStateDot'
import type { DashboardAgentRow } from '@/components/dashboard/useDashboardData'
import { useAgentRowConversationName } from '@/components/dashboard/use-agent-row-conversation-name'
import { useFocusedAgentPaneKey } from '@/components/sidebar/focused-agent-row-highlight'
import { getAgentDotState } from '@/components/sidebar/worktree-card-agent-summary'
import { useWorktreeAgentRows } from '@/components/sidebar/useWorktreeAgentRows'
import { getAgentRowPrimaryText } from '@/lib/agent-row-primary-text'
import { formatAgentTypeLabel } from '@/lib/agent-status'
import { AgentTypeIcon } from '@/lib/agent-type-icon'
import { isAutomationTabTitle } from '../../shared/automation-tab-title'
import { AutomationRunRowIcon } from '../automation-tab/AutomationRunGlyph'

// The Projects card's agent icon, with the automation icon for an automation's session as Activity shows it.
function SessionAgentIcon({ row }: { row: DashboardAgentRow }): React.JSX.Element {
  if (isAutomationTabTitle(row.tab.customTitle)) {
    return <AutomationRunRowIcon agentLabel={formatAgentTypeLabel(row.agentType)} />
  }
  return (
    <span className="inline-flex size-4 shrink-0 items-center justify-center">
      <AgentTypeIcon agentType={row.agentType} size={14} />
    </span>
  )
}

function OpenSession({
  row,
  onLocate
}: {
  row: DashboardAgentRow
  onLocate: () => void
}): React.JSX.Element {
  const state = getAgentDotState(row)
  const title =
    useAgentRowConversationName(row) ??
    (getAgentRowPrimaryText(row.entry) || agentStateLabel(state))
  return (
    <button
      type="button"
      onClick={onLocate}
      aria-label={`${title}, ${agentStateLabel(state)}: show in list`}
      className="flex min-w-0 items-center gap-1.5 rounded-md bg-worktree-sidebar-foreground/5 px-1.5 py-1 text-left text-xs hover:bg-worktree-sidebar-foreground/8 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-worktree-sidebar-ring"
    >
      <span className="inline-flex size-4 shrink-0 items-center justify-center">
        <AgentStateDot state={state} size="md" title={null} />
      </span>
      <SessionAgentIcon row={row} />
      <span className="min-w-0 flex-1 truncate font-medium text-foreground">{title}</span>
      <span className="shrink-0 text-3xs font-semibold uppercase tracking-[0.05em] text-muted-foreground">
        open
      </span>
    </button>
  )
}

/** The session the workbench shows in this worktree (the focused agent pane), or a muted note. */
export function CurrentSessionRow({
  worktreeId,
  onLocate
}: {
  worktreeId: string
  onLocate: () => void
}): React.JSX.Element {
  const rows = useWorktreeAgentRows(worktreeId)
  const focused = useFocusedAgentPaneKey(worktreeId)
  const row = focused ? rows.find((candidate) => candidate.paneKey === focused) : undefined
  if (!row) {
    return (
      <p className="rounded-md bg-worktree-sidebar-foreground/5 px-1.5 py-1 text-xs text-muted-foreground">
        No session open in this worktree
      </p>
    )
  }
  return <OpenSession row={row} onLocate={onLocate} />
}
