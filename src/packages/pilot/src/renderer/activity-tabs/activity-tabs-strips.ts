import { FLOATING_TERMINAL_WORKTREE_ID } from '../../../../../shared/constants'
import { useActivityTabsVisible } from './activity-tabs-setting'

// pilot-hook: activity-tabs-titlebar. Without a portal target the titlebar tab bar renders nothing.
export function useActivityTabsTitlebarController<T extends { titlebarTabsTarget: unknown }>(
  controller: T
): T {
  const hidden = useActivityTabsVisible()
  return hidden ? { ...controller, titlebarTabsTarget: null } : controller
}

// pilot-hook: activity-tabs-strip. 'external' is the existing "another surface owns this strip";
// the floating workspace keeps its strip because its tabs never appear in Activity.
export function useActivityTabsTabStrip(
  tabStrip: 'attached' | 'external',
  worktreeId: string
): 'attached' | 'external' {
  const hidden = useActivityTabsVisible()
  return hidden && worktreeId !== FLOATING_TERMINAL_WORKTREE_ID ? 'external' : tabStrip
}
