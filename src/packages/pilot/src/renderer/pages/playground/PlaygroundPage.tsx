import { useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import { isWebClientLocation } from '@/lib/web-client-location'
import type { PlaygroundProject, PlaygroundStatus } from '../../../shared/playground-types'
import { pilotRpc } from '../../api'
import { Select } from '../waiting/InboxHeader'

// The page notices a playground its own Stop ended, or one that exited.
const POLL_MS = 3_000

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

// What the line beside Start says: nothing while stopped cleanly.
function statusText(status: PlaygroundStatus | null, busy: boolean): string | null {
  if (status?.state === 'starting' || (busy && status?.state !== 'running')) {
    return 'Starting…'
  }
  if (status?.state === 'running') {
    return `Running at ${new URL(status.url).host}`
  }
  return null
}

function ProjectOptions({ projects }: { projects: PlaygroundProject[] }): React.JSX.Element {
  return (
    <>
      {projects.map((p) => (
        <option key={p.path} value={p.path}>
          {p.name}
        </option>
      ))}
    </>
  )
}

function Idle({
  projects,
  status
}: {
  projects: PlaygroundProject[] | null
  status: PlaygroundStatus | null
}): React.JSX.Element {
  if (status?.state === 'stopped' && status.reason) {
    return <p className="text-sm text-destructive">{status.reason}</p>
  }
  if (projects?.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        None of the repos in Pilot is a project pilotcli knows.
      </p>
    )
  }
  return (
    <p className="text-sm text-muted-foreground">
      Pick a project and Start. It stops when you press Stop, or when Pilot quits.
    </p>
  )
}

function PlaygroundHeader(): React.JSX.Element {
  return (
    <div>
      <h2 className="text-sm font-semibold leading-6">Playground</h2>
      <p className="text-xs text-muted-foreground">
        pilotcli&apos;s commands, each with a Try-it panel that runs it in one of the project&apos;s
        worktrees (an action as a dry run). View source opens a command&apos;s code here.
      </p>
    </div>
  )
}

// Its page is a loopback address on Pilot's machine, which a browser elsewhere can't open.
function PlaygroundElsewhere(): React.JSX.Element {
  return (
    <section className="flex h-full flex-col gap-3 px-5 pb-4 pt-4">
      <PlaygroundHeader />
      <p className="text-sm text-muted-foreground">
        The playground runs only on the machine Pilot runs on. Start it in Pilot there.
      </p>
    </section>
  )
}

// pilotcli's playground (main/playground): pick a project, Start, use its page here, Stop.
function PlaygroundHere(): React.JSX.Element {
  const [projects, setProjects] = useState<PlaygroundProject[] | null>(null)
  const [status, setStatus] = useState<PlaygroundStatus | null>(null)
  const [chosen, setChosen] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    let alive = true
    pilotRpc<PlaygroundProject[]>('pilot.playground.projects').then(
      (p) => alive && setProjects(p),
      (e) => alive && setError(messageOf(e))
    )
    const load = (): void => {
      pilotRpc<PlaygroundStatus>('pilot.playground.status').then(
        (s) => alive && setStatus(s),
        () => {}
      )
    }
    load()
    const timer = setInterval(load, POLL_MS)
    return () => {
      alive = false
      clearInterval(timer)
    }
  }, [])

  const live = status !== null && status.state !== 'stopped' ? status : null
  const repoPath = live?.repoPath ?? (chosen || projects?.[0]?.path || '')
  const act = async (call: () => Promise<PlaygroundStatus>): Promise<void> => {
    setBusy(true)
    setError(null)
    try {
      setStatus(await call())
    } catch (e) {
      setError(messageOf(e))
    } finally {
      setBusy(false)
    }
  }
  const start = (): Promise<void> =>
    act(() => pilotRpc<PlaygroundStatus>('pilot.playground.start', { repoPath }))
  const stop = (): Promise<void> => act(() => pilotRpc<PlaygroundStatus>('pilot.playground.stop'))
  const text = statusText(status, busy)

  return (
    <section className="flex h-full flex-col gap-3 px-5 pb-4 pt-4">
      <PlaygroundHeader />
      <div className="flex flex-wrap items-center gap-2">
        <Select
          label="Project"
          value={repoPath}
          onChange={setChosen}
          disabled={live !== null || busy || !projects?.length}
        >
          <ProjectOptions projects={projects ?? []} />
        </Select>
        {live ? (
          <Button variant="outline" size="sm" disabled={busy} onClick={() => void stop()}>
            Stop
          </Button>
        ) : (
          <Button size="sm" disabled={busy || repoPath === ''} onClick={() => void start()}>
            Start
          </Button>
        )}
        {text ? <span className="text-xs text-muted-foreground">{text}</span> : null}
        {status?.state === 'running' ? (
          <a className="text-xs underline" href={status.url} target="_blank" rel="noreferrer">
            Open in browser
          </a>
        ) : null}
      </div>
      {error ? <p className="text-sm text-destructive">{error}</p> : null}
      {status?.state === 'running' ? (
        <iframe
          title="pilotcli playground"
          src={status.url}
          className="min-h-0 w-full flex-1 rounded-md border border-border bg-background"
        />
      ) : (
        <Idle projects={projects} status={status} />
      )}
    </section>
  )
}

export function PlaygroundPage(): React.JSX.Element {
  return isWebClientLocation() ? <PlaygroundElsewhere /> : <PlaygroundHere />
}
