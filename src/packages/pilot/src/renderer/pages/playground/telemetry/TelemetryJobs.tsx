import { useState } from 'react'
import type { TelemetryJob } from '../../../../shared/api-types-telemetry'
import { badClass, countText, SECTION_CLASS, SECTION_HEAD_CLASS } from './telemetry-view'

const NUMBER = 'px-3 py-1.5 text-right font-mono tabular-nums'

function keyOf(job: TelemetryJob): string {
  return `${job.automation}|${job.name}`
}

// One step's commands: "gitlab check-mr ×3 · inbox create-card ×1".
function stepCommandsText(commands: TelemetryJob['steps'][number]['commands']): string {
  return commands.map((c) => `${c.command} ×${c.calls}`).join(' · ')
}

function JobRows({
  job,
  open,
  onToggle
}: {
  job: TelemetryJob
  open: boolean
  onToggle: () => void
}): React.JSX.Element {
  const caret = open ? '▾' : '▸'
  return (
    <>
      <tr className="border-t border-border/50">
        <td className="min-w-0 px-3 py-1.5">
          <button
            type="button"
            aria-expanded={open}
            className="w-full truncate text-left hover:underline"
            title={job.name}
            onClick={onToggle}
          >
            {`${caret} ${job.name}`}
          </button>
        </td>
        <td className={NUMBER}>{countText(job.runs)}</td>
        <td className={NUMBER}>{countText(job.calls)}</td>
        <td className={`${NUMBER} ${badClass('failed', job.failed)}`}>{countText(job.failed)}</td>
        <td className={`${NUMBER} ${badClass('invalid', job.invalid)}`}>
          {countText(job.invalid)}
        </td>
      </tr>
      {open
        ? job.steps.map((s) => (
            <tr key={s.step} className="text-xs text-muted-foreground">
              <td className="truncate py-1 pl-8 pr-3">{s.step || '(no step)'}</td>
              <td colSpan={4} className="break-words px-3 py-1 font-mono text-foreground/80">
                {stepCommandsText(s.commands)}
              </td>
            </tr>
          ))
        : null}
    </>
  )
}

// Each automation's runs and pilotcli calls in the window; a row opens to the commands each step called.
export function TelemetryJobs({ jobs }: { jobs: TelemetryJob[] }): React.JSX.Element {
  const [open, setOpen] = useState<ReadonlySet<string>>(new Set())
  const toggle = (key: string): void =>
    setOpen((was) => {
      const next = new Set(was)
      if (!next.delete(key)) {
        next.add(key)
      }
      return next
    })
  return (
    <section className={SECTION_CLASS}>
      <div className={SECTION_HEAD_CLASS}>
        <h3 className="text-sm font-semibold">By automation</h3>
      </div>
      {jobs.length === 0 ? (
        <p className="px-4 text-xs text-muted-foreground">
          No automation called pilotcli in this window.
        </p>
      ) : (
        <div className="overflow-x-auto">
          <table
            aria-label="By automation"
            className="w-full min-w-[26rem] table-fixed text-[13px]"
          >
            <colgroup>
              <col />
              <col className="w-16" />
              <col className="w-16" />
              <col className="w-16" />
              <col className="w-16" />
            </colgroup>
            <thead className="text-[11px] uppercase tracking-[0.08em] text-muted-foreground">
              <tr>
                <th className="px-3 py-2 text-left font-medium">Automation</th>
                <th className="px-3 py-2 text-right font-medium">Runs</th>
                <th className="px-3 py-2 text-right font-medium">Calls</th>
                <th className="px-3 py-2 text-right font-medium">Failed</th>
                <th className="px-3 py-2 text-right font-medium">Invalid</th>
              </tr>
            </thead>
            <tbody>
              {jobs.map((job) => (
                <JobRows
                  key={keyOf(job)}
                  job={job}
                  open={open.has(keyOf(job))}
                  onToggle={() => toggle(keyOf(job))}
                />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  )
}
