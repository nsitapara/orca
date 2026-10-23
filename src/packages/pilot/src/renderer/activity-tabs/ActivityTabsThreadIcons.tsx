import type { ReactNode } from 'react'
import { ThreadAgentStateIndicator } from '@/components/activity/activity-thread-controls'
import type { AgentPaneThread } from '@/components/activity/activity-thread-types'
import { AgentIcon } from '@/lib/agent-catalog'
import { agentTypeToIconAgent, formatAgentTypeLabel } from '@/lib/agent-status'
import { isAutomationTabTitle } from '../../shared/automation-tab-title'
import { AutomationRunRowIcon } from '../automation-tab/AutomationRunGlyph'
import { pilotStore } from '../store'

type IconProps = { thread: AgentPaneThread; children: ReactNode }

// pilot-hook: activity-tabs-thread-icons. With Pilot attached, a thread row leads with its agent's
// icon, like the tab rows around it, and its state moves to the footer where the agent icon was.
// An automation's session leads with the automation icon instead. `children` is upstream's own
// icon, kept while Pilot isn't attached.
export function ActivityTabsThreadLeadingIcon({ thread, children }: IconProps): ReactNode {
  if (!pilotStore()) {
    return children
  }
  if (isAutomationTabTitle(thread.tab.customTitle)) {
    return <AutomationRunRowIcon agentLabel={formatAgentTypeLabel(thread.agentType)} />
  }
  return (
    <span
      className="mt-0.5 inline-flex size-4 shrink-0 items-center justify-center"
      title={formatAgentTypeLabel(thread.agentType)}
    >
      <AgentIcon agent={agentTypeToIconAgent(thread.agentType)} size={14} />
    </span>
  )
}

export function ActivityTabsThreadFooterIcon({ thread, children }: IconProps): ReactNode {
  if (!pilotStore()) {
    return children
  }
  return <ThreadAgentStateIndicator thread={thread} />
}
