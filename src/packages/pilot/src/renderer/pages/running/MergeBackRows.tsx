import { Badge } from '@/components/ui/badge'
import type { MergeBackRow } from '../../../shared/api-types-capacity'
import { formatDuration } from '../../../shared/run/format-duration'
import type { PartState } from '../../../shared/run-views/paint'
import { usePilotHost } from '../../hosts/PilotHostContext'
import { openRun } from '../../run-views/run-panel-state'

const STATE_WORD: Record<PartState, string> = {
  done: 'Merged',
  running: 'Merging',
  asking: 'Needs you',
  failed: 'Failed',
  not_reached: 'Queued',
  skipped: 'Nothing to merge',
  none: 'Queued'
}

// A fix still in a throwaway Pilot can't remove (nothing kept it on a branch) is loud: Stuck, in red.
function stateWord(row: MergeBackRow): string {
  return row.branch === null ? 'Stuck' : STATE_WORD[row.state]
}

function badgeVariant(row: MergeBackRow): 'destructive' | 'outline' | 'secondary' {
  if (row.branch === null) {
    return 'destructive'
  }
  return row.state === 'not_reached' ? 'outline' : 'secondary'
}

function baseName(path: string): string {
  return (
    path
      .replace(/[\\/]+$/, '')
      .split(/[\\/]/)
      .pop() ?? path
  )
}

// The fix's job and where it stands, how long it has waited and its two runs on top; the branch and the worktree it goes
// to under it; then what job 15 says now (why it waits, its retry, what it's doing).
export function MergeBackItem({ row, now }: { row: MergeBackRow; now: number }): React.JSX.Element {
  const host = usePilotHost()
  const where = row.home ? baseName(row.home) : 'an unknown worktree'
  return (
    <li className="flex min-w-0 flex-col gap-1 px-3 py-2 text-sm">
      <div className="flex min-w-0 items-center gap-2">
        <span className="min-w-0 truncate font-medium" title={row.automationName}>
          {row.automationName}
        </span>
        <Badge variant={badgeVariant(row)}>{stateWord(row)}</Badge>
        <span className="ml-auto shrink-0 pl-2 text-xs tabular-nums text-muted-foreground">
          kept {formatDuration(Math.max(now - row.since, 0))} ago
        </span>
        <button
          type="button"
          className="shrink-0 text-xs underline"
          onClick={() => openRun(row.runId, null, host)}
        >
          Open run
        </button>
        {row.mergeRunId ? (
          <button
            type="button"
            className="shrink-0 text-xs underline"
            onClick={() => openRun(row.mergeRunId ?? row.runId, null, host)}
          >
            Open merge
          </button>
        ) : null}
      </div>
      <div className="truncate font-mono text-xs text-muted-foreground" title={row.home ?? ''}>
        {row.branch ?? 'not kept on a branch: still in its throwaway'} → {where} · {row.itemLabel}
      </div>
      {row.detail ? <p className="text-xs text-muted-foreground">{row.detail}</p> : null}
    </li>
  )
}
