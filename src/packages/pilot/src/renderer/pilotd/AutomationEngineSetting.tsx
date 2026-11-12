import { useState } from 'react'
import type { GlobalSettings } from '../../../../../shared/global-settings-types'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { SettingsSegmentedControl } from '@/components/settings/form-controls/SettingsFormControls'
import { SettingsGroup } from '@/components/settings/section-layout/SettingsGroup'
import {
  automationEngine,
  DEFAULT_PILOTD_ADDRESS,
  pilotdOrigin,
  type AutomationEngine,
  type PilotdHealth
} from '../../shared/automation-engine-settings'
import { pilotStore } from '../store'
import { usePilotdHealth } from './pilotd-engine'

const STATUS_POLL_MS = 10_000

export const ENGINE_CHOICES: { value: AutomationEngine; label: string; meaning: string }[] = [
  {
    value: 'builtin',
    label: 'Built-in',
    meaning: "Pilot's own engine runs the jobs and its own Automations pages show them."
  },
  {
    value: 'pilotd',
    label: 'pilotd',
    meaning:
      "pilotd runs the jobs; the Automations pages and the sidebar's counts show pilotd's dashboard."
  }
]

/** The line under the choice: whether pilotd answers at the address, and what it says. */
export function pilotdStatusText(origin: string | null, health: PilotdHealth | null): string {
  if (origin === null) {
    return "pilotd: the address isn't a web address. Use one like http://127.0.0.1:8787."
  }
  if (health === null) {
    return `pilotd: checking ${origin}…`
  }
  if (!health.reachable) {
    return `pilotd: not reachable at ${origin}. ${health.error}`
  }
  const engine = health.engineRunning ? 'engine running' : 'engine not running'
  const build = health.build ? ` · build ${health.build}` : ''
  return `pilotd: reachable at ${origin} · ${engine}${build}`
}

function statusTone(origin: string | null, health: PilotdHealth | null): string {
  if (origin === null || (health !== null && !health.reachable)) {
    return 'text-destructive'
  }
  if (health?.reachable && !health.engineRunning) {
    return 'text-status-warning'
  }
  return 'text-muted-foreground'
}

function AddressField({
  saved,
  onSave
}: {
  saved: string
  onSave: (address: string) => void
}): React.JSX.Element {
  const [draft, setDraft] = useState(saved)
  const save = (): void => {
    const next = draft.trim()
    if (next !== saved) {
      onSave(next)
    }
  }
  return (
    <div className="flex items-start justify-between gap-4 py-2">
      <div className="min-w-0 flex-1 space-y-0.5">
        <Label htmlFor="pilotd-address">pilotd address</Label>
        <p className="text-xs text-muted-foreground">
          Where pilotd serves its dashboard. Leave blank for {DEFAULT_PILOTD_ADDRESS}.
        </p>
      </div>
      <Input
        id="pilotd-address"
        density="compact"
        className="w-56"
        value={draft}
        placeholder={DEFAULT_PILOTD_ADDRESS}
        spellCheck={false}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={save}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            save()
          }
        }}
      />
    </div>
  )
}

/**
 * pilot-hook: settings-automation-engine. Settings › Automations: which engine runs the jobs, pilotd's address, and
 * whether pilotd answers there. Built-in keeps everything as it is.
 */
export function AutomationEngineSetting({
  settings,
  updateSettings
}: {
  settings: GlobalSettings
  updateSettings: (updates: Partial<GlobalSettings>) => Promise<void>
}): React.JSX.Element | null {
  const engine = automationEngine(settings.pilotAutomationEngine)
  const address = settings.pilotdAddress ?? ''
  const origin = pilotdOrigin(address)
  const { health } = usePilotdHealth(address, STATUS_POLL_MS, origin !== null)
  if (!pilotStore()) {
    return null
  }
  return (
    <SettingsGroup
      title="Automation engine"
      description="Which engine runs your automations. Built-in is the fallback if pilotd fails."
      bodyClassName="py-2"
    >
      <div className="flex items-start justify-between gap-4 py-2">
        <div className="min-w-0 flex-1 space-y-1">
          <Label>Automation engine</Label>
          {ENGINE_CHOICES.map((choice) => (
            <p key={choice.value} className="text-xs text-muted-foreground">
              <span className="font-medium text-foreground">{choice.label}:</span> {choice.meaning}
            </p>
          ))}
          <p role="status" className={`text-xs ${statusTone(origin, health)}`}>
            {pilotdStatusText(origin, health)}
          </p>
        </div>
        <SettingsSegmentedControl<AutomationEngine>
          value={engine}
          onChange={(next) => void updateSettings({ pilotAutomationEngine: next })}
          ariaLabel="Automation engine"
          size="sm"
          options={ENGINE_CHOICES.map(({ value, label }) => ({ value, label }))}
        />
      </div>
      <AddressField
        key={address}
        saved={address}
        onSave={(next) => void updateSettings({ pilotdAddress: next })}
      />
    </SettingsGroup>
  )
}
