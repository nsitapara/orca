import { useEffect, useState } from 'react'
import { X } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { RunDetail } from '../../shared/api-types'
import { homeOf } from '../../shared/api-types-env'
import { runStatusWord } from '../../shared/env-text'
import { money } from '../../shared/money'
import { paintRun, type PaintedRun } from '../../shared/run-views/paint'
import { runHeadline, runTimeline } from '../../shared/run-views/timeline'
import { formatDuration } from '../../shared/run/format-duration'
import { workedMs } from '../../shared/run/worked-time'
import { hostRpc } from '../hosts/host-rpc'
import { MachineChip } from '../hosts/MachineChip'
import { usePilotHost } from '../hosts/PilotHostContext'
import { showAutomationsPage, showInboxCard, showPilotAutomation } from '../pages/automations-view'
import { errorText, itemUrl, runStatusLabel } from '../pages/format'
import { openWorktree, worktreeIdForPath } from '../pages/waiting/WorktreeLink'
import { ContinueRun } from './ContinueRun'
import { useRunEffects } from './effects-feed'
import { WhatItChanged } from './EffectsLine'
import { envLines } from './env-lines'
import { RunTimeline } from './RunTimeline'
import { closeRunPanel, openRun } from './run-panel-state'
import { runTone } from './tokens'

export const RUN_PANEL_POLL_MS = 10_000
const LIVE: ReadonlySet<string> = new Set(['running', 'asking'])

// A link that leaves the panel: the page it opens shows without the panel over it.
function leave(go: () => void): () => void {
  return () => {
    closeRunPanel()
    go()
  }
}

function Fact({ name, children }: { name: string; children: React.ReactNode }): React.JSX.Element {
  return (
    <div className="contents">
      <dt className="text-muted-foreground">{name}</dt>
      <dd className="min-w-0 break-words">{children}</dd>
    </div>
  )
}

// The run's worktree on the run's machine: the same path can be another worktree here.
function Worktree({ path }: { path: string }): React.JSX.Element {
  const host = usePilotHost()
  const id = worktreeIdForPath(path, host)
  const name = path.replace(/\/+$/, '').split('/').pop() || path
  if (!id) {
    return <span title={path}>{name}</span>
  }
  return (
    <button
      type="button"
      title={path}
      className="underline"
      onClick={leave(() => openWorktree(id, host))}
    >
      {name}
    </button>
  )
}

// The run's state with the step it is at ("Failed at step 4"); a workspace still preparing or deferred says so instead.
function stateWord(detail: RunDetail, painted: PaintedRun): string {
  const { run } = detail
  const word = runStatusWord(run, runStatusLabel)
  if (word !== runStatusLabel(run.status)) {
    return word
  }
  return runHeadline(run, runTimeline(painted.parts, run), runStatusLabel)
}

function Header({
  detail,
  painted
}: {
  detail: RunDetail
  painted: PaintedRun
}): React.JSX.Element {
  const { run } = detail
  const host = usePilotHost()
  const url = itemUrl(run.fields)
  const home = homeOf(run)
  const parent = run.parentRunId
  return (
    <header className="flex flex-col gap-2">
      <nav
        aria-label="Crumbs"
        className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground"
      >
        <button type="button" onClick={leave(showAutomationsPage)}>
          Automations
        </button>
        <span>›</span>
        <button type="button" onClick={leave(() => showPilotAutomation(run.automationId, 'how'))}>
          {detail.automationName}
        </button>
        <span>›</span>
        <span className="text-foreground">{`Run ${run.id}`}</span>
        <MachineChip host={host} />
      </nav>
      <h3 className="text-sm font-semibold">
        {url ? (
          <a
            href={url}
            target="_blank"
            rel="noopener noreferrer"
            className="underline-offset-2 hover:underline"
          >
            {run.itemLabel}
          </a>
        ) : (
          run.itemLabel
        )}
      </h3>
      <dl className="grid grid-cols-[5.5rem_minmax(0,1fr)] gap-y-0.5 text-xs">
        <Fact name="State">
          <span className={cn('rounded px-1.5', runTone(run))}>{stateWord(detail, painted)}</span>
        </Fact>
        {home ? (
          <Fact name="Worktree">
            <Worktree path={home} />
          </Fact>
        ) : null}
        <Fact name="Started">{new Date(run.startedAt).toLocaleString()}</Fact>
        {run.finishedAt !== null ? (
          <Fact name="Took">{formatDuration(workedMs(run, run.finishedAt))}</Fact>
        ) : null}
        {run.costUsd !== null ? <Fact name="Spent">{money(run.costUsd)}</Fact> : null}
        {run.tickId !== null ? <Fact name="Tick">{`Tick ${run.tickId}`}</Fact> : null}
        {run.outcome ? <Fact name="Outcome">{run.outcome}</Fact> : null}
      </dl>
      {envLines(run).map((line) => (
        <div key={line} className="text-xs text-muted-foreground">
          {line}
        </div>
      ))}
      <div className="flex flex-wrap gap-3 text-xs">
        <button
          type="button"
          className="underline"
          onClick={leave(() => showPilotAutomation(run.automationId, 'how'))}
        >
          How it runs
        </button>
        <button
          type="button"
          className="underline"
          onClick={leave(() => showPilotAutomation(run.automationId, 'activity'))}
        >
          Activity
        </button>
        {parent ? (
          <button type="button" className="underline" onClick={() => openRun(parent, null, host)}>
            {`Answers run ${parent}`}
          </button>
        ) : null}
        <ContinueRun run={run} />
      </div>
    </header>
  )
}

// One run's timeline and its links (spec §2 Run panel), on the run's machine, polled so a running run moves along.
export function RunPanel({
  runId,
  part,
  onClose
}: {
  runId: string
  part: string | null
  onClose: () => void
}): React.JSX.Element {
  const host = usePilotHost()
  const [detail, setDetail] = useState<RunDetail | null>(null)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => {
    let alive = true
    const load = (): void => {
      hostRpc<RunDetail>(host, 'pilot.runs.get', { runId }).then(
        (d) => {
          if (alive) {
            setDetail(d)
            setError(null)
          }
        },
        (e: unknown) => {
          if (alive) {
            setError(errorText(e))
          }
        }
      )
    }
    load()
    const timer = setInterval(load, RUN_PANEL_POLL_MS)
    return () => {
      alive = false
      clearInterval(timer)
    }
  }, [runId, host])
  const effects = useRunEffects(runId, detail !== null && LIVE.has(detail.run.status))
  const painted = detail ? paintRun(detail.chain, detail) : null
  return (
    <div className="flex flex-col gap-4 p-4">
      <div className="flex justify-end">
        <button
          type="button"
          aria-label="Close run"
          className="rounded p-1 hover:bg-accent"
          onClick={onClose}
        >
          <X className="size-4" aria-hidden="true" />
        </button>
      </div>
      {error ? <p className="text-sm text-destructive">{error}</p> : null}
      {detail && painted ? (
        <>
          <Header detail={detail} painted={painted} />
          <WhatItChanged effects={effects} />
          <RunTimeline
            parts={painted.parts}
            run={detail.run}
            highlight={part}
            drifted={painted.drifted}
            onOpenRun={(id) => openRun(id, null, host)}
            onOpenCard={(id) => leave(() => showInboxCard(id, host))()}
          />
        </>
      ) : null}
      {!detail && !error ? <p className="text-sm text-muted-foreground">Loading…</p> : null}
    </div>
  )
}
