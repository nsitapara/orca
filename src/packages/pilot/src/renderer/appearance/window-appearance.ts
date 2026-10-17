import { resolveLeftSidebarStyleVariables } from '@/lib/left-sidebar-appearance'
import './window-appearance.css'

type WindowAppearanceSettings = Parameters<typeof resolveLeftSidebarStyleVariables>[0]

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

// Match Terminal themes the whole window, not only the sidebars: the sidebar's terminal surface tokens,
// plus the popover and secondary tokens that only overlays and the center column read.
export function resolvePilotWindowStyleVariables(
  settings: WindowAppearanceSettings,
  systemPrefersDark: boolean
): Record<string, string> | undefined {
  if (settings?.leftSidebarAppearanceMode !== 'match-terminal') {
    return undefined
  }
  const vars = resolveLeftSidebarStyleVariables(settings, systemPrefersDark)
  if (!vars) {
    return undefined
  }
  return {
    ...vars,
    '--popover': vars['--card'],
    '--popover-foreground': vars['--foreground'],
    '--secondary': vars['--muted'],
    '--secondary-foreground': vars['--foreground']
  }
}

// Called from attachPilotRenderer (pilot-hook: renderer). Inline root variables beat the `.dark` theme
// block, so the center column, tab bar, status bar and every portaled overlay follow the terminal theme.
export function attachPilotWindowAppearance(
  store: WindowAppearanceStore,
  root: HTMLElement,
  darkQuery: DarkModeQuery = window.matchMedia('(prefers-color-scheme: dark)')
): () => void {
  let applied: string[] = []
  let lastSettings: WindowAppearanceSettings | 'unset' = 'unset'

  const apply = (): void => {
    const vars = resolvePilotWindowStyleVariables(store.getState().settings, darkQuery.matches)
    for (const name of applied) {
      root.style.removeProperty(name)
    }
    applied = vars ? Object.keys(vars) : []
    for (const [name, value] of Object.entries(vars ?? {})) {
      root.style.setProperty(name, value)
    }
    if (vars) {
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
