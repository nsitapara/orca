import { useState } from 'react'
import { isWebClientLocation } from '@/lib/web-client-location'
import { pilotRpc } from '../../../api'
import { openRun } from '../../../run-views/run-panel-state'
import { SourceLink } from '../../../run-views/SourceLink'
import type {
  TelemetryCall,
  TelemetryFailures as Failures,
  TelemetryWindow
} from '../../../../shared/api-types-telemetry'
import {
  badClass,
  callTimeText,
  causeText,
  commandText,
  keyedCalls,
  outcomeText,
  SECTION_CLASS,
  SECTION_HEAD_CLASS,
  whoText,
  windowText
} from './telemetry-view'

const CAUSES_NOTE =
  'Causes are fixed categories (timeout, HTTP status, parse, git, unknown command, unknown flag, bad value, ' +
  'missing argument, precondition, refused, interrupted, stack start, stack stop; invalid flag on older calls). ' +
  'Free-text reasons are never stored: they can carry PHI.'

const CELL = 'px-3 py-1.5'

function outcomeClass(outcome: string): string {
  if (outcome === 'failed' || outcome === 'invalid') {
    return badClass(outcome, 1)
  }
  return 'text-muted-foreground'
}

// pilot.runs.get's answer for a run this Mac doesn't have (main/rpc/run-views' runDetail).
function isNoRun(error: unknown): boolean {
  return error instanceof Error && error.message.startsWith('No run')
}

// "Open run" for a call that has a run. The telemetry is this Mac's, so the run is read here; a run that isn't on this
// Mac (or was deleted) turns into its id as plain text, never a link that opens an error. Any other failure (a
// timeout) leaves the link to try again. FailureRow keys it on the run, so `gone` never outlives its run.
function RunCell({ run }: { run: string }): React.JSX.Element {
  const [gone, setGone] = useState(false)
  if (gone) {
    return <span className="block max-w-40 truncate">{run}</span>
  }
  const open = (): void => {
    pilotRpc('pilot.runs.get', { runId: run }).then(
      () => openRun(run),
      (error: unknown) => setGone(isNoRun(error))
    )
  }
  return (
    <button type="button" className="underline" onClick={open}>
      Open run
    </button>
  )
}

function FailureRow({
  call,
  now,
  names
}: {
  call: TelemetryCall
  now: Date
  names: ReadonlyMap<string, string>
}): React.JSX.Element {
  return (
    <tr className="border-t border-border/50 align-top">
      <td className={`${CELL} whitespace-nowrap font-mono text-muted-foreground`} title={call.ts}>
        {callTimeText(call.ts, now)}
      </td>
      <td
        className={`${CELL} whitespace-nowrap font-mono ${call.command ? '' : 'text-muted-foreground'}`}
      >
        {commandText(call.command, call.attempted, call.cause)}
      </td>
      <td className={`${CELL} whitespace-nowrap ${outcomeClass(call.outcome)}`}>
        {outcomeText(call)}
      </td>
      <td className={`${CELL} whitespace-nowrap`}>
        <span className="rounded border border-border px-1.5 py-0.5 text-xs">
          {causeText(call)}
        </span>
      </td>
      <td className={`${CELL} break-words text-muted-foreground`}>{whoText(call, names)}</td>
      <td
        className={`${CELL} whitespace-nowrap font-mono text-xs text-muted-foreground`}
        title={call.run}
      >
        {call.run ? <RunCell key={call.run} run={call.run} /> : '-'}
      </td>
    </tr>
  )
}

function FailuresBody({
  failures,
  since,
  command,
  now,
  names
}: {
  failures: Failures
  since: TelemetryWindow
  command: string | null
  now: Date
  names: ReadonlyMap<string, string>
}): React.JSX.Element {
  if ('unavailable' in failures) {
    return <p className="px-4 text-xs text-muted-foreground">{failures.unavailable}</p>
  }
  if (failures.calls.length === 0) {
    const forText = command ? ` for ${command}` : ''
    return (
      <p className="px-4 text-xs text-muted-foreground">
        {`No failed or invalid calls${forText} in ${windowText(since)}.`}
      </p>
    )
  }
  return (
    <>
      <div className="overflow-x-auto">
        {/* Auto layout: the short columns keep their text on one line, and Who · where takes the rest and wraps. */}
        <table
          aria-label="Recent failed and invalid calls"
          className="w-full min-w-[36rem] text-[13px]"
        >
          <thead className="text-[11px] uppercase tracking-[0.08em] text-muted-foreground">
            <tr>
              <th className="px-3 py-2 text-left font-medium">Time</th>
              <th className="px-3 py-2 text-left font-medium">Command</th>
              <th className="px-3 py-2 text-left font-medium">Outcome</th>
              <th className="px-3 py-2 text-left font-medium">Cause</th>
              <th className="px-3 py-2 text-left font-medium">Who · where</th>
              <th className="px-3 py-2 text-left font-medium">Run</th>
            </tr>
          </thead>
          <tbody>
            {keyedCalls(failures.calls).map(({ key, call }) => (
              <FailureRow key={key} call={call} now={now} names={names} />
            ))}
          </tbody>
        </table>
      </div>
      <p className="px-4 text-xs text-muted-foreground">{CAUSES_NOTE}</p>
      {failures.more ? (
        <p className="px-4 text-xs text-muted-foreground">Showing the newest 50.</p>
      ) : null}
    </>
  )
}

// The picked command with its Source and Try it (Try it needs the desktop's playground), and Clear.
function PickedBar({
  command,
  onTryIt,
  onClear
}: {
  command: string
  onTryIt?: (command: string) => void
  onClear?: () => void
}): React.JSX.Element {
  const web = isWebClientLocation()
  return (
    <div className="flex flex-wrap items-center gap-x-2 px-4 text-xs">
      <span className="font-mono">{command}</span>
      <SourceLink part={{ skill: null, runs: `pilotcli ${command}` }} />
      {onTryIt && !web ? (
        <button type="button" className="underline" onClick={() => onTryIt(command)}>
          Try it
        </button>
      ) : null}
      {onClear ? (
        <button type="button" className="underline" onClick={onClear}>
          Clear
        </button>
      ) : null}
    </div>
  )
}

// The window's newest failed and invalid calls, every command's or the one picked, with their causes.
export function TelemetryFailures({
  failures,
  since,
  command,
  now,
  names,
  onTryIt,
  onClear
}: {
  failures: Failures
  since: TelemetryWindow
  command: string | null
  now: Date
  names: ReadonlyMap<string, string>
  onTryIt?: (command: string) => void
  onClear?: () => void
}): React.JSX.Element {
  return (
    <section className={SECTION_CLASS}>
      <div className={SECTION_HEAD_CLASS}>
        <h3 className="text-sm font-semibold">
          Recent failed and invalid calls
          {command ? <span className="font-mono font-normal">{` for ${command}`}</span> : null}
        </h3>
      </div>
      {command ? <PickedBar command={command} onTryIt={onTryIt} onClear={onClear} /> : null}
      <FailuresBody failures={failures} since={since} command={command} now={now} names={names} />
    </section>
  )
}
