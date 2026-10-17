type SidebarBody = 'workspaces' | 'agents'
type SidebarBodyState = { sidebarBody: SidebarBody; setSidebarBody(body: SidebarBody): void }
export type SidebarBodyStore = {
  getState(): SidebarBodyState
  subscribe(listener: (state: SidebarBodyState, previous: SidebarBodyState) => void): () => void
}

export const SIDEBAR_BODY_KEY = 'pilot.sidebar.body'

function stored(): SidebarBody {
  try {
    return window.localStorage.getItem(SIDEBAR_BODY_KEY) === 'workspaces' ? 'workspaces' : 'agents'
  } catch {
    return 'agents'
  }
}

// Upstream opens on Workspaces at every launch, so every reinstall lost Activity: Pilot opens on the
// sidebar view last used, Activity by default (Nish, 2026-10-17), and remembers each switch.
export function rememberSidebarBody(store: SidebarBodyStore): () => void {
  store.getState().setSidebarBody(stored())
  return store.subscribe((state, previous) => {
    if (state.sidebarBody === previous.sidebarBody) {
      return
    }
    try {
      window.localStorage.setItem(SIDEBAR_BODY_KEY, state.sidebarBody)
    } catch {
      // Private windows and blocked storage: the next launch just opens on Activity.
    }
  })
}
