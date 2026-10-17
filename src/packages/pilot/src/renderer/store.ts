// The slice of Orca's app store that Pilot reads. Pilot's renderer behavior stays inert until
// attachPilotRenderer() registers the real store, so upstream tests and unattached runs see pure upstream behavior.
export type PilotStoreState = {
  rightSidebarOpen: boolean
  setRightSidebarOpen(open: boolean): void
  // Read by the Automations panel. Optional so the sidebar hooks' test fakes stay valid.
  activeWorktreeId?: string | null
  getKnownWorktreeById?(
    worktreeId: string
  ): { path: string; displayName?: string; repoId?: string } | undefined
  repos?: readonly { id: string; displayName: string }[]
  // Read by the sidebar's Inbox item.
  activeView?: string
  openAutomationsPage?(): void
  settings?: { showAutomationsButton?: boolean } | null
  // Read by the Inbox to open a worktree from its section.
  worktreesByRepo?: Record<string, { id: string; path: string }[]>
}
export type PilotStore = {
  getState(): PilotStoreState
  subscribe?(listener: () => void): () => void
}

let registered: PilotStore | null = null

export function registerPilotStore(store: PilotStore | null): void {
  registered = store
}

export function pilotStore(): PilotStore | null {
  return registered
}
