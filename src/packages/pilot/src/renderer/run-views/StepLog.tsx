import { useEffect, useState } from 'react'
import type { StepRow } from '../../shared/api-types'
import { safeHref } from '../../shared/safe-href'
import type { LogEntry, LogEntryDetail, LogStatus } from '../../shared/visibility-types'
import { hostRpc } from '../hosts/host-rpc'
import { usePilotHost } from '../hosts/PilotHostContext'
import { clockTime, errorText } from '../pages/format'
import { useStepLog } from './use-step-log'

const MARK: Record<LogStatus, string> = { ok: '✓', error: '✗', interrupted: '⏹', pending: '…' }
const LABELS: [RegExp, (m: RegExpExecArray) => string][] = [
  [/\/-\/merge_requests\/(\d+)/, (m) => `!${m[1]}`],
  [/\/-\/pipelines\/(\d+)/, (m) => `pipeline ${m[1]}`],
  [/\/-\/jobs\/(\d+)/, (m) => `job ${m[1]}`],
  [/\/issue\/([A-Z][A-Z0-9]*-\d+)/, (m) => m[1]]
]
const PRE =
  'max-h-64 overflow-auto whitespace-pre-wrap break-all rounded bg-muted/50 p-2 font-mono text-[11px]'

// A link's short name in a log line: !N, pipeline N, job N or a ticket id; anything else is "link".
export function linkLabel(url: string): string {
  for (const [pattern, label] of LABELS) {
    const m = pattern.exec(url)
    if (m) {
      return label(m)
    }
  }
  return 'link'
}

// One of a log line's links: clickable only when it is http(s), else its name as plain text.
function EntryLink({ url }: { url: string }): React.JSX.Element {
  const href = safeHref(url)
  if (!href) {
    return <span>{linkLabel(url)}</span>
  }
  return (
    <a href={href} target="_blank" rel="noopener noreferrer" className="underline">
      {linkLabel(url)}
    </a>
  )
}

function isLive(step: StepRow): boolean {
  return step.status === 'running' || step.status === 'starting'
}

function cutNote(cut: number): string {
  return cut > 0 ? ` · first ${cut} characters not shown` : ''
}

function Block({
  title,
  text,
  cut
}: {
  title: string
  text: string
  cut: number
}): React.JSX.Element {
  return (
    <div>
      <div className="text-[11px] font-semibold uppercase text-muted-foreground">{`${title}${cutNote(cut)}`}</div>
      <pre className={PRE}>{text || '(empty)'}</pre>
    </div>
  )
}

function Detail({
  runId,
  stepIdx,
  id
}: {
  runId: string
  stepIdx: number
  id: string
}): React.JSX.Element {
  const host = usePilotHost()
  const [detail, setDetail] = useState<LogEntryDetail | null>(null)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => {
    let alive = true
    const read = hostRpc<LogEntryDetail>(host, 'pilot.runs.logEntry', { runId, stepIdx, id })
    Promise.resolve(read).then(
      (got) => {
        if (alive && typeof got?.output === 'string') {
          setDetail(got)
        }
      },
      (e: unknown) => {
        if (alive) {
          setError(errorText(e))
        }
      }
    )
    return () => {
      alive = false
    }
  }, [runId, stepIdx, id, host])
  if (error) {
    return <p className="text-destructive">{error}</p>
  }
  if (!detail) {
    return <p className="text-muted-foreground">Loading…</p>
  }
  return (
    <div className="flex flex-col gap-1">
      {detail.input ? <Block title="Input" text={detail.input} cut={detail.inputCut} /> : null}
      <Block title="Output" text={detail.output} cut={detail.outputCut} />
    </div>
  )
}

function Mark({ entry }: { entry: LogEntry }): React.JSX.Element {
  if (entry.kind === 'text') {
    return <span aria-hidden="true">●</span>
  }
  return (
    <>
      <span aria-hidden="true">{MARK[entry.status]}</span>
      <span className="sr-only">{entry.status}</span>
    </>
  )
}

function Row({
  entry,
  runId,
  stepIdx
}: {
  entry: LogEntry
  runId: string
  stepIdx: number
}): React.JSX.Element {
  const [open, setOpen] = useState(false)
  const tool = entry.kind === 'tool' ? entry : null
  return (
    <li className="flex flex-col">
      <button
        type="button"
        aria-expanded={open}
        className="flex w-full items-baseline gap-2 text-left hover:bg-accent/50"
        onClick={() => setOpen(!open)}
      >
        <span className="shrink-0 text-muted-foreground">{clockTime(entry.at)}</span>
        <Mark entry={entry} />
        <span className="min-w-0 truncate font-mono">{entry.title}</span>
        {tool?.summary ? (
          <span className="shrink-0 text-muted-foreground">{tool.summary}</span>
        ) : null}
      </button>
      {tool && tool.links.length > 0 ? (
        <span className="ml-6 flex flex-wrap gap-2">
          {tool.links.map((link) => (
            <EntryLink key={link} url={link} />
          ))}
        </span>
      ) : null}
      {open ? (
        <div className="ml-6">
          <Detail runId={runId} stepIdx={stepIdx} id={entry.id} />
        </div>
      ) : null}
    </li>
  )
}

// What an agent step ran (Run visibility spec §1): its condensed log, live while it runs; each line opens to its full
// input and output.
export function StepLog({ runId, step }: { runId: string; step: StepRow }): React.JSX.Element {
  const { log, error } = useStepLog(runId, step.idx, isLive(step))
  if (!log && error) {
    return <p className="text-destructive">{error}</p>
  }
  if (!log) {
    return <p className="text-muted-foreground">Loading the log…</p>
  }
  if (log.source === 'none') {
    return <p className="text-muted-foreground">{log.reason}</p>
  }
  return (
    <section aria-label="Log" className="mt-1 flex flex-col gap-0.5">
      {log.truncatedBefore > 0 ? (
        <p className="text-muted-foreground">{`${log.truncatedBefore} earlier entries not shown`}</p>
      ) : null}
      <ol className="flex flex-col gap-0.5">
        {log.entries.map((entry) => (
          <Row key={entry.id} entry={entry} runId={runId} stepIdx={step.idx} />
        ))}
      </ol>
      {log.entries.length === 0 ? (
        <p className="text-muted-foreground">Nothing in the log yet.</p>
      ) : null}
      {error ? <p className="text-destructive">{error}</p> : null}
      {log.later > 0 ? (
        <p className="text-muted-foreground">{`${log.later} later entries from a resumed session aren't this run's`}</p>
      ) : null}
    </section>
  )
}

// What a shell step printed, as Pilot kept it (its last 8 KB; stdout it may not keep reads as a note).
export function ShellOutput({ text }: { text: string }): React.JSX.Element {
  return (
    <pre aria-label="Output" className={`mt-1 ${PRE}`}>
      {text}
    </pre>
  )
}
