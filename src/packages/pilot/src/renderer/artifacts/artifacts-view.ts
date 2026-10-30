import { useSyncExternalStore } from 'react'
import { useAppStore } from '@/store'
import { localFlag } from '../activity-tabs/activity-tabs-setting'

// The Artifacts page's tabs: what agents published, the HTML reports in the vault, ids only the account knows, and
// Orca's own shared links (signed in only).
export type ArtifactsTab = 'agents' | 'local' | 'untracked' | 'shared'

export type ArtifactsView = {
  tab: ArtifactsTab
  query: string
  // A repo name, or '' for every repo.
  repo: string
  // The worktree or folder "Show all in Artifacts" opened the page on, or null.
  worktree: { path: string; label: string } | null
  // The artifact whose drawer is open.
  selected: string | null
}

const INITIAL: ArtifactsView = {
  tab: 'agents',
  query: '',
  repo: '',
  worktree: null,
  selected: null
}

/** The tab showing: Orca's shared links need its sign-in, so without one the page falls back to From agents. */
export function shownArtifactsTab(tab: ArtifactsTab, signedIn: boolean): ArtifactsTab {
  return tab === 'shared' && !signedIn ? 'agents' : tab
}

let view: ArtifactsView = INITIAL
const listeners = new Set<() => void>()

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export function artifactsView(): ArtifactsView {
  return view
}

export function updateArtifactsView(patch: Partial<ArtifactsView>): void {
  view = { ...view, ...patch }
  for (const listener of listeners) {
    listener()
  }
}

export function useArtifactsView(): ArtifactsView {
  return useSyncExternalStore(subscribe, artifactsView, () => INITIAL)
}

/** "Show all in Artifacts →": the page, on From agents, filtered to one worktree or folder. */
export function showArtifactsForWorktree(worktree: { path: string; label: string }): void {
  updateArtifactsView({ tab: 'agents', query: '', repo: '', worktree, selected: null })
  useAppStore.getState().openArtifactsPage()
}

/** Opens the page with one artifact's drawer, on whichever tab lists it. */
export function showArtifact(id: string, tab: ArtifactsTab): void {
  updateArtifactsView({ tab, query: '', repo: '', worktree: null, selected: id })
  useAppStore.getState().openArtifactsPage()
}

// The sidebar's fold-out starts open; closing it is remembered.
const foldClosed = localFlag('pilot.sidebar.artifacts-fold-closed')

export function useArtifactsFoldOpen(): boolean {
  return !foldClosed.useValue()
}

export function setArtifactsFoldOpen(open: boolean): void {
  foldClosed.set(!open)
}

// Tests only.
export function resetArtifactsView(): void {
  view = INITIAL
}
