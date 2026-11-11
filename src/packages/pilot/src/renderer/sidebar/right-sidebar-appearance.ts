import { useLayoutEffect, type RefObject } from 'react'
import { resolveLeftSidebarStyleVariables } from '@/app-shell/appearance/left-sidebar-appearance'
import { pilotStore } from '../store'

type SidebarAppearanceSettings = Parameters<typeof resolveLeftSidebarStyleVariables>[0]

// pilot-hook: right-sidebar-appearance. Orca scopes the Tinted sidebar appearance to the left sidebar
// only; set the same variables on the right sidebar so both match.
export function usePilotRightSidebarAppearance(
  ref: RefObject<HTMLElement | null>,
  useStore: (
    selector: (s: { settings: SidebarAppearanceSettings }) => SidebarAppearanceSettings
  ) => SidebarAppearanceSettings
): void {
  const settings = useStore((s) => s.settings)
  useLayoutEffect(() => {
    const el = ref.current
    const vars = pilotStore() ? resolveLeftSidebarStyleVariables(settings) : undefined
    if (!el || !vars) {
      return
    }
    for (const [name, value] of Object.entries(vars)) {
      el.style.setProperty(name, value)
    }
    return () => {
      for (const name of Object.keys(vars)) {
        el.style.removeProperty(name)
      }
    }
  }, [ref, settings])
}
