import type {
  TelemetryCall,
  TelemetryFailures as Failures,
  TelemetryWindow
} from '../../../../shared/api-types-telemetry'
import {
  badClass,
  callTimeText,
  causeText,
  keyedCalls,
  SECTION_CLASS,
  SECTION_HEAD_CLASS,
  whoText,
  windowText
} from './telemetry-view'

const CAUSES_NOTE =
  'Causes are fixed categories (timeout, HTTP status, parse, git, invalid flag, stack start). ' +
  'Free-text reasons are never stored: they can carry PHI.'

const CELL = 'px-3 py-1.5'

function outcomeClass(outcome: string): string {
  if (outcome === 'failed' || outcome === 'invalid') {
    return badClass(outcome, 1)
  }
  return 'text-muted-foreground'
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
      <td className={`${CELL} break-words font-mono`}>{call.command}</td>
      <td className={`${CELL} ${outcomeClass(call.outcome)}`}>{call.outcome}</td>
      <td className={`${CELL} whitespace-nowrap`}>
        <span className="rounded border border-border px-1.5 py-0.5 text-xs">
          {causeText(call)}
        </span>
      </td>
      <td className={`${CELL} break-words text-muted-foreground`}>{whoText(call, names)}</td>
      {/* The run's id as text, until it links to the run panel. */}
      <td className={`${CELL} truncate font-mono text-xs text-muted-foreground`} title={call.run}>
        {call.run ?? '-'}
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
        <table
          aria-label="Recent failed and invalid calls"
          className="w-full min-w-[36rem] table-fixed text-[13px]"
        >
          <colgroup>
            <col className="w-28" />
            <col />
            <col className="w-20" />
            <col className="w-28" />
            <col />
            <col className="w-36" />
          </colgroup>
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

// The window's newest failed and invalid calls, every command's or the one picked, with their causes.
export function TelemetryFailures({
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
  return (
    <section className={SECTION_CLASS}>
      <div className={SECTION_HEAD_CLASS}>
        <h3 className="text-sm font-semibold">
          Recent failed and invalid calls
          {command ? <span className="font-mono font-normal">{` for ${command}`}</span> : null}
        </h3>
      </div>
      <FailuresBody failures={failures} since={since} command={command} now={now} names={names} />
    </section>
  )
}
