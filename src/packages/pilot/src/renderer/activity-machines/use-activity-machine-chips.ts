import { useMemo } from 'react'
import { useShallow } from 'zustand/react/shallow'
import { getSettingsFocusedExecutionHostId } from '../../../../../shared/execution-host'
import { getHostDisplayLabelOverrides } from '../../../../../shared/host-setting-overrides'
import type { ActivityThreadGroup } from '@/components/activity/activity-thread-types'
import { buildSidebarHostOptions } from '@/components/sidebar/sidebar-host-options'
import { useAppStore } from '@/store'
import { groupRows } from '../activity-tabs/activity-tabs-rows'
import { pilotStore } from '../store'
import { buildActivityMachineLabels, type ActivityMachineRow } from './activity-machine-labels'
import type { ActivityMachineChips } from './activity-machine-chips-context'

/** A group's agents, then its Pilot rows, a worktree header's own row included. */
export function activityGroupMachineRows(group: ActivityThreadGroup): ActivityMachineRow[] {
  return [
    ...group.threads,
    ...groupRows(group).map((row) => (row.kind === 'tab' ? row.tab : row.recent))
  ]
}

const sameLabels = (labels: ReadonlyMap<string, string> | null) => labels

/** Whether an Activity list's rows span machines, decided once for the whole list; null until Pilot attaches. */
export function useActivityMachineChips(
  groups: readonly ActivityThreadGroup[]
): ActivityMachineChips | null {
  const repos = useAppStore((s) => s.repos)
  const sshTargetLabels = useAppStore((s) => s.sshTargetLabels)
  const settings = useAppStore((s) => s.settings)
  const runtimeEnvironments = useAppStore((s) => s.runtimeEnvironments)
  // Why: no live status here; it would re-render the whole list on every tick.
  const hosts = useMemo(
    () =>
      buildSidebarHostOptions({
        repos,
        sshTargetLabels,
        settings,
        runtimeEnvironments,
        hostLabelOverrides: getHostDisplayLabelOverrides(settings)
      }),
    [repos, sshTargetLabels, settings, runtimeEnvironments]
  )
  const defaultHostId = getSettingsFocusedExecutionHostId(settings)
  const builtLabels = useMemo(
    // Collapsed groups count too, so folding one never drops the chips.
    () =>
      buildActivityMachineLabels({
        rows: groups.flatMap(activityGroupMachineRows),
        defaultHostId,
        hosts
      }),
    [groups, defaultHostId, hosts]
  )
  // Why: the same Map comes back while the labels are equal, so the chips skip a re-render.
  const labels = useShallow(sameLabels)(builtLabels)
  const chips = useMemo(() => (labels ? { labels, defaultHostId } : null), [labels, defaultHostId])
  return pilotStore() ? chips : null
}
