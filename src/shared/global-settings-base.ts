import type { ClaudeAccountSwitchSettings } from './claude-account-switch-settings'
import type { NativeChatGlobalSettings } from './native-chat-appearance-settings'
import type { WorktreeDeletionPreferences } from './worktree-deletion-preferences'
import type { EmptyWorkspaceOpenSurfaceSettings } from '../packages/pilot/src/shared/empty-workspace-open-surface-settings' // pilot-hook: empty-workspace-settings
import type { SidebarPagesSettings } from '../packages/pilot/src/shared/sidebar-pages-settings' // pilot-hook: sidebar-pages-settings

/** Settings groups owned by their feature modules and composed into GlobalSettings. */
export type GlobalSettingsBase = NativeChatGlobalSettings &
  WorktreeDeletionPreferences &
  ClaudeAccountSwitchSettings &
  EmptyWorkspaceOpenSurfaceSettings & // pilot-hook: empty-workspace-settings
  SidebarPagesSettings // pilot-hook: sidebar-pages-settings
