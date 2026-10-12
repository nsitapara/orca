import type { AutomationDetailPayload } from '../../shared/api-types'
import type { StepDef } from '../../shared/definition/types'
import { scheduleText } from './AutomationsTable'
import { formatDuration } from '../../shared/run/format-duration'
import { formatInZone } from './format'

const AGENT: Record<StepDef['agent'], string> = { claude: 'Claude', codex: 'Codex', shell: 'Shell' }

function skillText(step: StepDef): string | null {
  if (!step.skill) {
    return null
  }
  if (!step.mode) {
    return step.skill
  }
  return `${step.skill} (mode ${step.mode})`
}

function sessionText(step: StepDef): string | null {
  if (step.session.kind === 'continue') {
    return `continues ${step.session.step}'s session`
  }
  if (step.session.kind === 'per_worktree') {
    return 'one session per worktree'
  }
  return null
}

function timeoutText(step: StepDef): string | null {
  if (step.timeoutMs === null) {
    return null
  }
  return `times out after ${formatDuration(step.timeoutMs)}`
}

// One line per step: who runs it, with what, and when it runs.
export function stepSummary(step: StepDef): string {
  const parts = [
    AGENT[step.agent],
    skillText(step),
    step.run ? `runs ${step.run}` : null,
    step.when ? `when ${step.when}` : null,
    step.always ? 'always runs' : null,
    timeoutText(step),
    sessionText(step)
  ]
  return parts.filter((p): p is string => p !== null).join(' · ')
}

export function AutomationOverview({
  detail
}: {
  detail: AutomationDetailPayload
}): React.JSX.Element {
  const s = detail.summary
  const next = s.nextTickAt === null ? 'None' : formatInZone(s.nextTickAt, s.timezone)
  const facts: [string, string][] = [
    ['Looks at', s.itemKind],
    ['Schedule', `${scheduleText(s)} (${s.timezone})`],
    ['Next tick', next],
    ['Powers', s.powers.length ? s.powers.join(', ') : 'Nothing outside the worktree'],
    ['Inbox', s.inbox],
    ['Status', s.enabled ? 'Enabled' : 'Paused']
  ]
  return (
    <div className="flex flex-col gap-3">
      <dl className="grid grid-cols-[8rem_1fr] gap-y-1 text-sm">
        {facts.map(([k, v]) => (
          <div key={k} className="contents">
            <dt className="text-muted-foreground">{k}</dt>
            <dd>{v}</dd>
          </div>
        ))}
      </dl>
      <div>
        <div className="text-sm font-medium">Steps</div>
        <ol className="mt-1 space-y-1 text-sm">
          {detail.steps.map((step, i) => (
            <li key={step.name} className="flex flex-wrap gap-2">
              <span className="font-medium">{`${i + 1}. ${step.name}`}</span>
              <span className="text-muted-foreground">{stepSummary(step)}</span>
            </li>
          ))}
        </ol>
      </div>
      <pre className="overflow-auto rounded-md border border-border/50 bg-muted/20 p-3 text-xs">
        {detail.yaml}
      </pre>
    </div>
  )
}
