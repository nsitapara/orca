import type { AutomationListPayload } from '../../shared/api-types'

// The loader's messages start with the file path (`<file>: <problem>`). Strip it from each one
// and show it once in front.
function fileProblem(file: string, errors: string[]): string {
  const prefix = `${file}: `
  const problems = errors.map((e) => (e.startsWith(prefix) ? e.slice(prefix.length) : e))
  return `${file}: ${problems.join(' · ')}`
}

// Things that need fixing, shown above the table in plain words. Never blocks the list.
export function ProblemNotices({
  payload,
  startError
}: {
  payload: AutomationListPayload | null
  startError: string | null
}): React.JSX.Element | null {
  const lines: { key: string; text: string; bad: boolean }[] = []
  if (startError) {
    lines.push({ key: 'start', text: `Pilot couldn't start: ${startError}`, bad: true })
  }
  for (const e of payload?.errors ?? []) {
    lines.push({ key: e.file, text: fileProblem(e.file, e.errors), bad: true })
  }
  if (payload?.peopleError) {
    lines.push({ key: 'people', text: `People: ${payload.peopleError}`, bad: false })
  }
  if (payload?.missingDirs.length) {
    lines.push({
      key: 'dirs',
      text: `Folder not found: ${payload.missingDirs.join(', ')}`,
      bad: false
    })
  }
  if (!lines.length) {
    return null
  }
  return (
    <div className="flex flex-col gap-1">
      {lines.map((l) => (
        <p
          key={l.key}
          className={l.bad ? 'text-sm text-destructive' : 'text-sm text-muted-foreground'}
        >
          {l.text}
        </p>
      ))}
    </div>
  )
}
