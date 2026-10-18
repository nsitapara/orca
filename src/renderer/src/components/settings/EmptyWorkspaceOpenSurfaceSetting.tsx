import type { GlobalSettings } from '../../../../shared/global-settings-types'
import { Label } from '../ui/label'
import { SearchableSetting } from './SearchableSetting'
import { SettingsSegmentedControl } from './SettingsFormControls'
import {
  getEmptyWorkspaceOpenSurfaceDescription,
  getEmptyWorkspaceOpenSurfaceLabel,
  getEmptyWorkspaceOpenSurfaceSearchKeywords,
  getEmptyWorkspaceOpenSurfaceTitle,
  type EmptyWorkspaceOpenSurface
} from './empty-workspace-open-surface-copy'

export function EmptyWorkspaceOpenSurfaceSetting({
  settings,
  updateSettings
}: {
  settings: GlobalSettings
  updateSettings: (updates: Partial<GlobalSettings>) => void
}): React.JSX.Element {
  const title = getEmptyWorkspaceOpenSurfaceTitle()
  const description = getEmptyWorkspaceOpenSurfaceDescription()
  const surface: EmptyWorkspaceOpenSurface = settings.emptyWorkspaceOpenSurface ?? 'default-agent'

  return (
    <SearchableSetting
      title={title}
      description={description}
      keywords={getEmptyWorkspaceOpenSurfaceSearchKeywords()}
    >
      <div className="flex items-start justify-between gap-4 py-2">
        <div className="min-w-0 flex-1 space-y-0.5">
          <Label>{title}</Label>
          <p className="text-xs text-muted-foreground">{description}</p>
        </div>
        <SettingsSegmentedControl<EmptyWorkspaceOpenSurface>
          value={surface}
          onChange={(next) => updateSettings({ emptyWorkspaceOpenSurface: next })}
          ariaLabel={title}
          size="sm"
          options={[
            { value: 'default-agent', label: getEmptyWorkspaceOpenSurfaceLabel('default-agent') },
            { value: 'terminal', label: getEmptyWorkspaceOpenSurfaceLabel('terminal') }
          ]}
        />
      </div>
    </SearchableSetting>
  )
}
