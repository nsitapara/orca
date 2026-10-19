import {
  ChevronDown,
  ChevronRight,
  FileCode,
  Gauge,
  SlidersHorizontal,
  Sparkles
} from 'lucide-react'
import { useState } from 'react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import { cn } from '@/lib/utils'
import type { CapacityPayload } from '../../../shared/api-types-capacity'
import { RetryLimitPicker, RunLimitPicker } from './LimitPickers'
import { checkNow, JOB_DECIDES, PLACE_RULES, quotaUseText, RUNNER_CHECKS } from './running-checks'
import { limitsSummary, memoryField, quotaText, retryHint, suggestionText } from './running-text'

// The header's limits as set, and the button that opens them with how the runner works.
export function LimitsToggle({
  payload,
  open,
  controls,
  onToggle
}: {
  payload: CapacityPayload
  open: boolean
  // The panel's id, for aria-controls.
  controls: string
  onToggle(): void
}): React.JSX.Element {
  return (
    <div className="flex flex-wrap items-center justify-end gap-x-3 gap-y-1">
      <span className="text-xs text-muted-foreground">{limitsSummary(payload)}</span>
      <Button
        variant="outline"
        size="sm"
        aria-expanded={open}
        aria-controls={controls}
        onClick={onToggle}
      >
        <SlidersHorizontal className="size-3.5" />
        Limits &amp; how it works
        <ChevronDown className={cn('size-3.5 transition-transform', open && 'rotate-180')} />
      </Button>
    </div>
  )
}

function LimitField({
  label,
  hint,
  children
}: {
  label: string
  hint: React.ReactNode
  children: React.ReactNode
}): React.JSX.Element {
  return (
    <div className="flex min-w-0 flex-col gap-1.5 rounded-lg border border-border/50 p-3">
      <span className="text-xs text-muted-foreground">{label}</span>
      {children}
      <span className="text-2xs text-muted-foreground">{hint}</span>
    </div>
  )
}

function ReadOnlyValue({ children }: { children: React.ReactNode }): React.JSX.Element {
  return (
    <span className="flex min-h-8 items-center text-sm font-medium tabular-nums">{children}</span>
  )
}

// Small fields: the two limits Nish sets, and the quota and memory they work within.
function LimitFields({
  payload,
  where,
  saving,
  onLimit,
  onRetryLimit
}: {
  payload: CapacityPayload
  where: string
  saving: boolean
  onLimit(limit: number | null): void
  onRetryLimit(limit: number): void
}): React.JSX.Element {
  const suggested = payload.suggestion.limit
  const memory = memoryField(payload)
  const ceiling = payload.quotaCeiling
  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
      <LimitField
        label="Jobs at once"
        hint={
          <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
            Suggested {suggested}: what memory fits
            {payload.limit === suggested ? null : (
              <Button
                variant="outline"
                size="xs"
                disabled={saving}
                onClick={() => onLimit(suggested)}
              >
                Use {suggested}
              </Button>
            )}
          </span>
        }
      >
        <RunLimitPicker limit={payload.limit} disabled={saving} onChange={onLimit} />
      </LimitField>
      {payload.retryLimit === undefined ? null : (
        <LimitField label="Retries after a failure" hint={retryHint()}>
          <RetryLimitPicker limit={payload.retryLimit} disabled={saving} onChange={onRetryLimit} />
        </LimitField>
      )}
      {ceiling ? (
        <LimitField label="Agent quota ceiling" hint={quotaUseText(payload) ?? quotaText(ceiling)}>
          <ReadOnlyValue>
            {ceiling.weekly}% weekly · {ceiling.session}% session
          </ReadOnlyValue>
        </LimitField>
      ) : null}
      {memory ? (
        <LimitField label={`Memory on ${where}`} hint={memory.held ?? 'No running job holds any'}>
          <ReadOnlyValue>{memory.free}</ReadOnlyValue>
        </LimitField>
      ) : null}
      <p className="text-2xs text-muted-foreground sm:col-span-2 lg:col-span-4">
        {suggestionText(payload)} Memory counts each job&apos;s processes on {where}, not
        Docker&apos;s containers.
      </p>
    </div>
  )
}

function OwnerCard({
  icon,
  title,
  note,
  items
}: {
  icon: React.ReactNode
  title: string
  note: string
  items: readonly [string, string][]
}): React.JSX.Element {
  return (
    <div className="flex min-w-0 flex-col gap-2 rounded-lg border border-border/50 p-3">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-muted-foreground">
        {icon}
        <span className="text-sm font-medium text-foreground">{title}</span>
        <span className="text-2xs">{note}</span>
      </div>
      <ul className="flex list-disc flex-col gap-1 pl-4 text-xs text-muted-foreground">
        {items.map(([lead, rest]) => (
          <li key={lead}>
            <span className="font-medium text-foreground">{lead}</span> {rest}
          </li>
        ))}
      </ul>
    </div>
  )
}

const RUNNER_ITEMS: readonly [string, string][] = [
  ['When it starts:', 'the line, Jobs at once, agent quota, per-job limits'],
  ['Retries', 'after a failure, and giving up with a card'],
  [
    'Where it works:',
    'your worktree, or a throwaway with its own stack while you have work in flight'
  ],
  ['Bringing commits home:', 'merge back, else kept on pilot/<run>'],
  ['Cleaning up:', 'stacks, throwaways, ended tabs']
]

const JOB_ITEMS: readonly [string, string][] = [
  ['Which items:', 'worktrees, MRs, tickets, pipelines, cards'],
  ['What is due:', 'once per head, first sight, the MR rules'],
  ['The steps:', 'context, agent, push, merge back, in order'],
  ['Its schedule', 'and its own limits']
]

const SKILL_ITEMS: readonly [string, string][] = [
  ['The work:', 'review, fix, test, draft the reply'],
  ['Commits', 'in the folder Pilot gives it; never pushes or picks the place'],
  ['Cards', 'for anything that needs you']
]

function WhoHandlesWhat(): React.JSX.Element {
  return (
    <div className="flex flex-col gap-2">
      <h3 className="text-xs font-semibold text-muted-foreground">Who handles what</h3>
      <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
        <OwnerCard
          icon={<Gauge className="size-3.5" />}
          title="Pilot's runner"
          note="built in, every job"
          items={RUNNER_ITEMS}
        />
        <OwnerCard
          icon={<FileCode className="size-3.5" />}
          title="The job file"
          note="automations/*.yaml"
          items={JOB_ITEMS}
        />
        <OwnerCard
          icon={<Sparkles className="size-3.5" />}
          title="The skill"
          note="the agent's judgment"
          items={SKILL_ITEMS}
        />
      </div>
      <p className="text-xs text-muted-foreground">
        Nothing the runner does is silent: a held row in Waiting says why and what frees it, and
        each finished run says where it worked and what came home.
      </p>
    </div>
  )
}

function CheckGroup({
  title,
  note,
  children
}: {
  title: string
  note: string
  children: React.ReactNode
}): React.JSX.Element {
  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
        <span className="text-xs font-semibold">{title}</span>
        <span className="text-xs text-muted-foreground">{note}</span>
      </div>
      {children}
    </div>
  )
}

const HEAD = 'px-3 py-2 font-medium'
const CELL = 'border-t border-border/50 px-3 py-2 align-top'

function RunnerChecksTable({ payload }: { payload: CapacityPayload }): React.JSX.Element {
  return (
    <div className="overflow-x-auto rounded-lg border border-border/50">
      <table className="w-full text-left text-xs">
        <thead className="text-muted-foreground">
          <tr>
            <th scope="col" className={HEAD}>
              Check
            </th>
            <th scope="col" className={HEAD}>
              Holds it while
            </th>
            <th scope="col" className={HEAD}>
              Checked again
            </th>
            <th scope="col" className={HEAD}>
              Now
            </th>
          </tr>
        </thead>
        <tbody>
          {RUNNER_CHECKS.map((check) => {
            const now = checkNow(check, payload)
            return (
              <tr key={check.name}>
                <td className={cn(CELL, 'whitespace-nowrap font-medium')}>{check.name}</td>
                <td className={cn(CELL, 'text-muted-foreground')}>{check.holds}</td>
                <td className={cn(CELL, 'whitespace-nowrap text-muted-foreground')}>
                  {check.again}
                </td>
                <td
                  className={cn(
                    CELL,
                    'whitespace-nowrap tabular-nums',
                    now.holding ? 'text-status-warning' : 'text-muted-foreground'
                  )}
                >
                  {now.text}
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

// Every check before a run starts, in the runner's order: what is due, when it starts, where it works.
function EveryCheck({ payload }: { payload: CapacityPayload }): React.JSX.Element {
  const [open, setOpen] = useState(false)
  return (
    <div className="border-t border-border/50 pt-3">
      <Collapsible open={open} onOpenChange={setOpen}>
        <CollapsibleTrigger asChild>
          <button
            type="button"
            className="flex items-center gap-1 self-start text-left text-xs font-semibold text-foreground"
          >
            <ChevronRight
              aria-hidden
              className={cn('size-3.5 transition-transform', open && 'rotate-90')}
            />
            Every check before a run starts, in order
            <span className="font-normal text-muted-foreground">
              · {JOB_DECIDES.length} decide what, {RUNNER_CHECKS.length} decide when, 1 decides
              where
            </span>
          </button>
        </CollapsibleTrigger>
        <CollapsibleContent>
          <div className="mt-3 flex flex-col gap-4">
            <CheckGroup
              title="1 · The job decides what is due"
              note="Not due is skipped until the next tick. It never waits in line."
            >
              <div className="flex flex-wrap gap-1.5">
                {JOB_DECIDES.map((name) => (
                  <Badge key={name} variant="outline">
                    {name}
                  </Badge>
                ))}
              </div>
            </CheckGroup>
            <CheckGroup
              title="2 · The runner decides when"
              note="The first that fails holds the item in Waiting with its reason, and the runner checks it again."
            >
              <RunnerChecksTable payload={payload} />
            </CheckGroup>
            <CheckGroup
              title="3 · The runner decides where, never a reason to wait"
              note="Uncommitted files, a merge or rebase, someone typing, or an agent working in your worktree."
            >
              <div className="grid grid-cols-1 gap-2 md:grid-cols-3">
                {PLACE_RULES.map((rule) => (
                  <div
                    key={rule.title}
                    className="flex flex-col gap-1 rounded-lg border border-border/50 p-3 text-xs"
                  >
                    <span className="font-medium">{rule.title}</span>
                    <span className="text-muted-foreground">{rule.body}</span>
                  </div>
                ))}
              </div>
            </CheckGroup>
          </div>
        </CollapsibleContent>
      </Collapsible>
    </div>
  )
}

// What opens under the header: the limits as small fields, who handles what, and every check the runner makes.
export function LimitsPanel({
  id,
  payload,
  where,
  saving,
  onLimit,
  onRetryLimit
}: {
  id: string
  payload: CapacityPayload
  where: string
  saving: boolean
  onLimit(limit: number | null): void
  onRetryLimit(limit: number): void
}): React.JSX.Element {
  return (
    <section
      id={id}
      aria-label="Limits and how it works"
      className="flex flex-col gap-4 rounded-lg border border-border/50 bg-card p-4"
    >
      <div className="flex flex-col gap-2">
        <h3 className="text-xs font-semibold text-muted-foreground">Limits</h3>
        <LimitFields
          payload={payload}
          where={where}
          saving={saving}
          onLimit={onLimit}
          onRetryLimit={onRetryLimit}
        />
      </div>
      <WhoHandlesWhat />
      <EveryCheck payload={payload} />
    </section>
  )
}
