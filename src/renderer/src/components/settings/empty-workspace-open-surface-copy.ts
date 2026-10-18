import { translate } from '@/i18n/i18n'
import type { GlobalSettings } from '../../../../shared/global-settings-types'
import { translateSearchKeyword } from './settings-search-keywords'

export type EmptyWorkspaceOpenSurface = NonNullable<GlobalSettings['emptyWorkspaceOpenSurface']>

export function getEmptyWorkspaceOpenSurfaceTitle(): string {
  return translate(
    'auto.components.settings.empty-workspace-open-surface-copy.title',
    'Opening an Empty Workspace'
  )
}

export function getEmptyWorkspaceOpenSurfaceDescription(): string {
  return translate(
    'auto.components.settings.empty-workspace-open-surface-copy.description',
    'What opens when you click a workspace with no tabs. Default agent starts the agent chosen in Agents settings.'
  )
}

export function getEmptyWorkspaceOpenSurfaceLabel(surface: EmptyWorkspaceOpenSurface): string {
  if (surface === 'terminal') {
    return translate(
      'auto.components.settings.empty-workspace-open-surface-copy.terminal',
      'Terminal'
    )
  }
  return translate(
    'auto.components.settings.empty-workspace-open-surface-copy.defaultAgent',
    'Default agent'
  )
}

export function getEmptyWorkspaceOpenSurfaceSearchKeywords(): string[] {
  return [
    ...translateSearchKeyword(
      'auto.components.settings.empty-workspace-open-surface-copy.keywordEmpty',
      'empty'
    ),
    ...translateSearchKeyword(
      'auto.components.settings.empty-workspace-open-surface-copy.keywordClick',
      'click'
    ),
    ...translateSearchKeyword(
      'auto.components.settings.empty-workspace-open-surface-copy.keywordOpen',
      'open'
    ),
    ...translateSearchKeyword(
      'auto.components.settings.empty-workspace-open-surface-copy.keywordAgent',
      'agent'
    ),
    ...translateSearchKeyword(
      'auto.components.settings.empty-workspace-open-surface-copy.keywordTerminal',
      'terminal'
    ),
    ...translateSearchKeyword(
      'auto.components.settings.empty-workspace-open-surface-copy.keywordWorktree',
      'worktree'
    ),
    'Claude'
  ]
}
