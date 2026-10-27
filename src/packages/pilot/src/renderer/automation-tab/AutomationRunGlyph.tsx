import { Bot } from 'lucide-react'

/** What an automation's tab shows in place of its agent's icon (automation-tab-title.ts). */
export function AutomationRunGlyph({ size }: { size: number }): React.JSX.Element {
  return <Bot size={size} aria-hidden className="shrink-0 text-callout-note" />
}

/** An Activity row's leading icon for an automation's session or tab. Its tooltip still names the
 *  agent, which the glyph no longer shows. */
export function AutomationRunRowIcon({ agentLabel }: { agentLabel: string }): React.JSX.Element {
  return (
    <span
      className="inline-flex size-4 shrink-0 items-center justify-center"
      title={`Automation run (${agentLabel})`}
    >
      <AutomationRunGlyph size={14} />
    </span>
  )
}
