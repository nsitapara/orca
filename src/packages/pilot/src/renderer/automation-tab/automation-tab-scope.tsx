import { createContext, useContext, type ReactNode } from 'react'
import type { TerminalAgent } from '../../../../../shared/terminal-agent'
import type { TerminalTab } from '../../../../../shared/terminal-tab-types'
import { AgentIcon } from '@/lib/agent-catalog'
import { isAutomationTabTitle } from '../../shared/automation-tab-title'
import { pilotStore } from '../store'
import { AutomationRunGlyph } from './AutomationRunGlyph'

const AutomationTabContext = createContext(false)

// pilot-hook: tab-bar-automation-scope. A terminal tab an automation opened (named "[Automation] …"
// at launch) tells the icons inside it, its hover card's included. `children` is upstream's tab,
// unchanged.
export function AutomationTabScope({
  tab,
  children
}: {
  tab: Pick<TerminalTab, 'customTitle'>
  children: ReactNode
}): React.JSX.Element {
  const automation = pilotStore() !== null && isAutomationTabTitle(tab.customTitle)
  return (
    <AutomationTabContext.Provider value={automation}>{children}</AutomationTabContext.Provider>
  )
}

// pilot-hook: tab-bar-automation-glyph. A tab's agent glyph: upstream's AgentIcon, or the
// automation glyph inside an automation's tab.
export function TabAgentGlyph({
  agent,
  size
}: {
  agent: TerminalAgent
  size: number
}): React.JSX.Element {
  if (useContext(AutomationTabContext)) {
    return <AutomationRunGlyph size={size} />
  }
  return <AgentIcon agent={agent} size={size} />
}

// pilot-hook: tab-drag-automation-glyph. A dragged agent tab's ghost, drawn in a portal outside the
// tab: the automation glyph when its label (the tab's customTitle first) names an automation's tab,
// as the resting tab shows.
export function DragTabAgentGlyph({
  agent,
  label,
  size
}: {
  agent: TerminalAgent
  label: string
  size: number
}): React.JSX.Element {
  if (pilotStore() !== null && isAutomationTabTitle(label)) {
    return <AutomationRunGlyph size={size} />
  }
  return <AgentIcon agent={agent} size={size} />
}
