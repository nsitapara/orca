import { useContext, useMemo, useState, type ReactNode } from 'react'
import {
  ActivityThreadCollapseContext,
  type ActivityThreadCollapseState
} from '@/components/activity/activity-thread-collapse-context'
import { pilotStore } from '../store'
import {
  isWorktreeGroupKey,
  toggleWorktreeGroupFold,
  useFoldedWorktreeGroups
} from './activity-worktree-folds'

function toggled(keys: ReadonlySet<string>, key: string): ReadonlySet<string> {
  const next = new Set(keys)
  if (!next.delete(key)) {
    next.add(key)
  }
  return next
}

/**
 * Upstream's collapse set for the Activity list, with a worktree group's fold taken from Pilot's
 * saved set: Pilot is relaunched on every rebuild, and upstream's set lives in React state. Other
 * groups keep the host's set, or the pane's own when the host has none (the Activity page).
 */
export function WorktreeFoldCollapseProvider({ children }: { children: ReactNode }): ReactNode {
  const outer = useContext(ActivityThreadCollapseContext)
  const folded = useFoldedWorktreeGroups()
  const [local, setLocal] = useState<ReadonlySet<string>>(() => new Set())
  const value = useMemo((): ActivityThreadCollapseState => {
    const hostKeys = [...(outer?.collapsedGroupKeys ?? local)].filter(
      (key) => !isWorktreeGroupKey(key)
    )
    return {
      collapsedGroupKeys: new Set([...hostKeys, ...folded]),
      onToggleGroupCollapse: (groupKey) => {
        if (isWorktreeGroupKey(groupKey)) {
          toggleWorktreeGroupFold(groupKey)
        } else if (outer) {
          outer.onToggleGroupCollapse(groupKey)
        } else {
          setLocal((keys) => toggled(keys, groupKey))
        }
      }
    }
  }, [outer, local, folded])
  if (!pilotStore()) {
    return children
  }
  return (
    <ActivityThreadCollapseContext.Provider value={value}>
      {children}
    </ActivityThreadCollapseContext.Provider>
  )
}
