import type { AutomationListPayload } from '../../shared/api-types'

// The loader's messages start with the file path (`<file>: <problem>`). Strip it from each one
// and show it once in front.
function fileProblem(file: string, errors: string[]): string {
  const prefix = `${file}: `
  const problems = errors.map((e) => (e.startsWith(prefix) ? e.slice(prefix.length) : e))
  return `${file}: ${problems.join(' · ')}`
}

// Fixes job 15 hasn't merged into their worktrees yet; Running lists each with where it stands.
function unmergedText(count: number): string {
  const fixes =
    count === 1
      ? "1 fix made in a throwaway isn't in its worktree yet"
      : `${count} fixes made in throwaways aren't in their worktrees yet`
  return `${fixes}: Running › Merge back shows where each stands.`
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
  for (const w of payload?.warnings ?? []) {
    lines.push({ key: `warn:${w.file}`, text: fileProblem(w.file, w.warnings), bad: false })
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
  if (payload?.unmergedFixes) {
    lines.push({ key: 'merge-back', text: unmergedText(payload.unmergedFixes), bad: false })
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
