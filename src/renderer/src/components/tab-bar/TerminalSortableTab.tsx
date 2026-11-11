import { useTabAgent } from '@/lib/agent-session/tab-identity/use-tab-agent'
import SortableTab from './SortableTab'
import type { SortableTabProps } from './SortableTab'
import type { TerminalTab } from '../../../../shared/workspace-layout/terminal-tab-types'
import { AutomationTabScope } from '../../../../packages/pilot/src/renderer/automation-tab/automation-tab-scope' // pilot-hook: tab-bar-automation-scope

type TerminalSortableTabProps = Omit<SortableTabProps, 'tab' | 'agent'> & { tab: TerminalTab }

/** A terminal pane can change agents, so its identity is inferred from live pane signals. */
export default function TerminalSortableTab(props: TerminalSortableTabProps): React.JSX.Element {
  const agent = useTabAgent(props.tab)
  return (
    <AutomationTabScope tab={props.tab}>
      <SortableTab {...props} agent={agent} />
    </AutomationTabScope>
  )
}
