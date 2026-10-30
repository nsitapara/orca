import { requestScrollToCurrentWorkspaceReveal } from '@/lib/scroll-to-current-workspace-status'
import {
  setActivityInactiveExpanded,
  useActivityInactiveExpanded
} from '../activity-tabs/activity-tabs-setting'

// Set by ActivityTabsGroupHeader and Pilot's session rows, so a locate can find them.
export const WORKTREE_HEADER_ATTRIBUTE = 'data-pilot-worktree-header'
export const SESSION_WORKTREE_ATTRIBUTE = 'data-pilot-session-worktree'

// Enough frames to walk a long Activity list a viewport at a time.
const MAX_STEPS = 80

type Frame = (callback: () => void) => void

export type LocateDeps = {
  root: ParentNode
  nextFrame: Frame
  inactiveExpanded: () => boolean
  expandInactive: () => void
}

function byWorktree(root: ParentNode, attribute: string, worktreeId: string): HTMLElement | null {
  return root.querySelector<HTMLElement>(`[${attribute}="${CSS.escape(worktreeId)}"]`)
}

function scrollParent(element: HTMLElement | null): HTMLElement | null {
  for (let node = element?.parentElement ?? null; node; node = node.parentElement) {
    const { overflowY } = getComputedStyle(node)
    if (overflowY === 'auto' || overflowY === 'scroll') {
      return node
    }
  }
  return null
}

function center(element: HTMLElement): void {
  element.scrollIntoView({ block: 'center' })
}

/**
 * Brings a worktree's header into Activity's virtual list, which mounts only the rows near the
 * viewport. A mounted header or session row is scrolled to directly; otherwise the list is walked
 * from the top a viewport per frame, then once more with Inactive unfolded. Best effort: a
 * worktree filtered out of the list is never found, and the walk just stops.
 */
export function locateActivityWorktree(worktreeId: string, deps: LocateDeps): void {
  let steps = 0
  let unfolded = false
  let sessionTried = false
  let walking = false
  let list: HTMLElement | null = null
  const attempt = (): void => {
    const header = byWorktree(deps.root, WORKTREE_HEADER_ATTRIBUTE, worktreeId)
    if (header) {
      center(header)
      return
    }
    if (steps >= MAX_STEPS) {
      return
    }
    steps += 1
    const session = sessionTried
      ? null
      : byWorktree(deps.root, SESSION_WORKTREE_ATTRIBUTE, worktreeId)
    if (session) {
      sessionTried = true
      // Its header sits just above; it mounts once the row is in view.
      center(session)
      deps.nextFrame(attempt)
      return
    }
    list ??= scrollParent(deps.root.querySelector<HTMLElement>(`[${WORKTREE_HEADER_ATTRIBUTE}]`))
    if (!list) {
      return
    }
    if (!walking) {
      walking = true
      list.scrollTop = 0
    } else if (list.scrollTop + list.clientHeight < list.scrollHeight - 1) {
      list.scrollTop += Math.max(1, list.clientHeight - 40)
    } else if (!unfolded && !deps.inactiveExpanded()) {
      unfolded = true
      deps.expandInactive()
    } else {
      return
    }
    deps.nextFrame(attempt)
  }
  attempt()
}

/** Scrolls the sidebar to the selected worktree's card, in whichever list it shows. */
export function useLocateSelectedWorktree(
  worktreeId: string | null,
  body: 'workspaces' | 'agents'
): () => void {
  const inactiveExpanded = useActivityInactiveExpanded()
  return () => {
    if (!worktreeId) {
      return
    }
    if (body === 'workspaces') {
      requestScrollToCurrentWorkspaceReveal()
      return
    }
    locateActivityWorktree(worktreeId, {
      root: document,
      nextFrame: (callback) => requestAnimationFrame(callback),
      inactiveExpanded: () => inactiveExpanded,
      expandInactive: () => setActivityInactiveExpanded(true)
    })
  }
}
