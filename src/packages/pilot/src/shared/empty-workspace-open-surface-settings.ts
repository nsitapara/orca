// Composed into upstream's GlobalSettingsBase (pilot-hook: empty-workspace-settings).
export type EmptyWorkspaceOpenSurfaceSettings = {
  /** What opening an empty workspace seeds: the default agent (a chat when Chat UI is on, else its
   *  terminal) or a plain shell. Absent means the default agent. */
  emptyWorkspaceOpenSurface?: 'default-agent' | 'terminal'
}
