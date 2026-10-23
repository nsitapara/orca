import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, describe, expect, it } from 'vitest'
import { TerminalTabLeadingIcon } from '@/components/tab-bar/TerminalTabLeadingIcon'
import { useAppStore } from '@/store'
import { registerPilotStore } from '../store'
import { AutomationTabScope, DragTabAgentGlyph } from './automation-tab-scope'

afterEach(() => registerPilotStore(null))

const cases = [
  { attached: true, title: '[Automation] Fix CI · !1561', robot: true },
  { attached: true, title: 'Fix CI · !1561', robot: false },
  { attached: false, title: '[Automation] Fix CI · !1561', robot: false }
]

// The one icon in the agent's place: the robot, or else the agent's logo.
function expectOneGlyph(markup: string, robot: boolean): void {
  expect(markup.match(/<svg/g)).toHaveLength(1)
  expect(markup.includes('lucide-bot')).toBe(robot)
}

// Why: in the tab bar, an automation's tab (named so at launch) shows the robot where its agent's logo was,
// beside its state, and so does its drag ghost; any other tab, or any tab without Pilot, keeps upstream's logo.
describe('a terminal tab’s agent glyph', () => {
  it.each(cases)(
    'attached=$attached, tab named $title → robot: $robot',
    ({ attached, title, robot }) => {
      registerPilotStore(attached ? useAppStore : null)
      const markup = renderToStaticMarkup(
        <AutomationTabScope tab={{ customTitle: title }}>
          <TerminalTabLeadingIcon
            agent="claude"
            activityStatus="working"
            shell={undefined}
            showUnreadActivity={false}
            isActive
          />
        </AutomationTabScope>
      )
      expect(markup).toContain('data-agent-activity-status="working"')
      const identity = markup.split('data-agent-icon="claude"')[1]?.split('</span>')[0] ?? ''
      expectOneGlyph(identity, robot)
    }
  )

  it.each(cases)(
    'attached=$attached, a dragged tab labelled $title → robot: $robot',
    ({ attached, title, robot }) => {
      registerPilotStore(attached ? useAppStore : null)
      const markup = renderToStaticMarkup(
        <DragTabAgentGlyph agent="claude" label={title} size={14} />
      )
      expectOneGlyph(markup, robot)
    }
  )
})
