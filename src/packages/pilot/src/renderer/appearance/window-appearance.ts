import { resolveEffectiveTerminalAppearance } from '@/lib/terminal/appearance/terminal-theme'
import type { GlobalSettings } from '../../../../../shared/global-settings-types'
import './window-appearance.css'

type WindowAppearanceSettings =
  | (Parameters<typeof resolveEffectiveTerminalAppearance>[0] &
      Pick<GlobalSettings, 'leftSidebarAppearanceMode'>)
  | null
  | undefined

export type WindowAppearanceStore = {
  getState(): { settings: WindowAppearanceSettings }
  subscribe(listener: () => void): () => void
}

type DarkModeQuery = {
  readonly matches: boolean
  addEventListener(type: 'change', listener: () => void): void
  removeEventListener(type: 'change', listener: () => void): void
}

// Read by window-appearance.css to recolor the overlay surfaces Orca hard-codes.
export const WINDOW_APPEARANCE_ATTRIBUTE = 'data-pilot-window-appearance'

export const ACTIVITY_GUIDE_VARIABLE = '--pilot-activity-guide'
export const SELECTION_ACCENT_VARIABLE = '--pilot-selection-accent'

// Activity's guide lines take the terminal theme's blue, softened, in every sidebar appearance, and the
// sidebar's selected worktree and open session take it whole.
export function resolveActivityGuideVariables(
  settings: WindowAppearanceSettings,
  systemPrefersDark: boolean
): Record<string, string> {
  if (!settings) {
    return {}
  }
  const blue = resolveEffectiveTerminalAppearance(settings, systemPrefersDark).theme?.blue
  return blue
    ? {
        [ACTIVITY_GUIDE_VARIABLE]: `color-mix(in srgb, ${blue} 50%, transparent)`,
        [SELECTION_ACCENT_VARIABLE]: blue
      }
    : {}
}

// Called from attachPilotRenderer (pilot-hook: renderer). Orca paints Match Terminal at :root itself and
// mirrors it in leftSidebarAppearanceMode; the attribute adds Pilot's overlay, divider and seam fixes.
export function attachPilotWindowAppearance(
  store: WindowAppearanceStore,
  root: HTMLElement,
  darkQuery: DarkModeQuery = window.matchMedia('(prefers-color-scheme: dark)')
): () => void {
  let applied: string[] = []
  let lastSettings: WindowAppearanceSettings | 'unset' = 'unset'

  const apply = (): void => {
    const { settings } = store.getState()
    const all = resolveActivityGuideVariables(settings, darkQuery.matches)
    for (const name of applied) {
      root.style.removeProperty(name)
    }
    applied = Object.keys(all)
    for (const [name, value] of Object.entries(all)) {
      root.style.setProperty(name, value)
    }
    if (settings?.leftSidebarAppearanceMode === 'match-terminal') {
      root.setAttribute(WINDOW_APPEARANCE_ATTRIBUTE, 'match-terminal')
    } else {
      root.removeAttribute(WINDOW_APPEARANCE_ATTRIBUTE)
    }
  }
  // The app store changes constantly; only a new settings object can change the theme.
  const onStoreChange = (): void => {
    const { settings } = store.getState()
    if (settings !== lastSettings) {
      lastSettings = settings
      apply()
    }
  }

  onStoreChange()
  const unsubscribe = store.subscribe(onStoreChange)
  darkQuery.addEventListener('change', apply)
  return () => {
    unsubscribe()
    darkQuery.removeEventListener('change', apply)
    for (const name of applied) {
      root.style.removeProperty(name)
    }
    root.removeAttribute(WINDOW_APPEARANCE_ATTRIBUTE)
  }
}
