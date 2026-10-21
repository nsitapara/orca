import { GitBranch } from 'lucide-react'
import { usePilotHost } from '../../hosts/PilotHostContext'
import { worktreeName } from '../waiting/answer-text'
import { openWorktree, repoNameForPath, worktreeIdForPath } from '../waiting/WorktreeLink'

// A running run's project and worktree, as an inbox card's place line names them; the name opens the worktree on the
// run's machine when the app has it there.
export function RunWorktreeLine({ path }: { path: string }): React.JSX.Element {
  const host = usePilotHost()
  const id = worktreeIdForPath(path, host)
  const project = repoNameForPath(path)
  const name = worktreeName(path)
  return (
    <div className="flex min-w-0 items-center gap-1.5 text-xs text-muted-foreground">
      {project ? (
        <>
          <span className="shrink-0">{project}</span>
          <span aria-hidden>/</span>
        </>
      ) : null}
      <GitBranch aria-hidden className="size-3 shrink-0" />
      {id ? (
        <button
          type="button"
          title={path}
          className="min-w-0 truncate font-mono text-foreground hover:underline"
          onClick={() => openWorktree(id, host)}
        >
          {name}
        </button>
      ) : (
        <span className="min-w-0 truncate font-mono text-foreground" title={path}>
          {name}
        </span>
      )}
    </div>
  )
}
