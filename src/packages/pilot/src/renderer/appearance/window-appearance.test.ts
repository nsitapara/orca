// @vitest-environment happy-dom
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { getDefaultSettings } from '../../../../../shared/constants'
import type { GlobalSettings } from '../../../../../shared/global-settings-types'
import { attachPilotWindowAppearance, WINDOW_APPEARANCE_ATTRIBUTE } from './window-appearance'

const MOCHA = { background: '#1e1e2e', foreground: '#cdd6f4' }

function settings(patch: Partial<GlobalSettings>): GlobalSettings {
  return { ...getDefaultSettings('/tmp'), terminalColorOverrides: MOCHA, ...patch }
}

function fakeStore(initial: GlobalSettings | null) {
  let state = { settings: initial }
  const listeners = new Set<() => void>()
  return {
    getState: () => state,
    subscribe(listener: () => void) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    set(next: GlobalSettings | null) {
      state = { settings: next }
      listeners.forEach((listener) => listener())
    }
  }
}

function fakeDarkQuery(matches: boolean) {
  const listeners = new Set<() => void>()
  return {
    matches,
    addEventListener: (_type: string, listener: () => void) => listeners.add(listener),
    removeEventListener: (_type: string, listener: () => void) => listeners.delete(listener),
    flip(next: boolean) {
      this.matches = next
      listeners.forEach((listener) => listener())
    }
  }
}

describe('attachPilotWindowAppearance', () => {
  const root = document.documentElement
  let detach = (): void => {}
  afterEach(() => {
    detach()
    root.removeAttribute('style')
  })

  it.each([
    ['match-terminal themes the window root', 'match-terminal', MOCHA.background, 'match-terminal'],
    ['tinted leaves the root to Orca', 'tinted', '', null],
    ['default leaves the root to Orca', 'default', '', null]
  ] as const)('%s', (_name, mode, background, attribute) => {
    const store = fakeStore(settings({ leftSidebarAppearanceMode: mode }))
    detach = attachPilotWindowAppearance(store, root, fakeDarkQuery(true))
    expect(root.style.getPropertyValue('--background')).toBe(background)
    expect(root.getAttribute(WINDOW_APPEARANCE_ATTRIBUTE)).toBe(attribute)
  })

  it('themes overlays and the center column, not only the sidebar tokens', () => {
    const store = fakeStore(settings({ leftSidebarAppearanceMode: 'match-terminal' }))
    detach = attachPilotWindowAppearance(store, root, fakeDarkQuery(true))
    expect(root.style.getPropertyValue('--popover')).toContain(MOCHA.background)
    expect(root.style.getPropertyValue('--popover-foreground')).toBe(MOCHA.foreground)
    expect(root.style.getPropertyValue('--card')).toContain(MOCHA.background)
  })

  it('hands the root back to Orca when the mode leaves match-terminal, keeping other inline vars', () => {
    root.style.setProperty('--app-font-family', 'Inter')
    const store = fakeStore(null)
    detach = attachPilotWindowAppearance(store, root, fakeDarkQuery(true))
    store.set(settings({ leftSidebarAppearanceMode: 'match-terminal' }))
    expect(root.style.getPropertyValue('--background')).toBe(MOCHA.background)
    store.set(settings({ leftSidebarAppearanceMode: 'default' }))
    expect(root.style.getPropertyValue('--background')).toBe('')
    expect(root.hasAttribute(WINDOW_APPEARANCE_ATTRIBUTE)).toBe(false)
    expect(root.style.getPropertyValue('--app-font-family')).toBe('Inter')
  })

  it('follows the system switching to light when the theme is system', () => {
    const store = fakeStore(
      settings({
        leftSidebarAppearanceMode: 'match-terminal',
        theme: 'system',
        terminalColorOverrides: undefined,
        terminalUseSeparateLightTheme: true
      })
    )
    const darkQuery = fakeDarkQuery(true)
    detach = attachPilotWindowAppearance(store, root, darkQuery)
    const dark = root.style.getPropertyValue('--background')
    darkQuery.flip(false)
    expect(root.style.getPropertyValue('--background')).not.toBe(dark)
  })
})

describe('window-appearance.css', () => {
  // The stylesheet swaps Orca's hard-coded glass recipe by its exact class text; if upstream renames it,
  // the override silently stops matching.
  it('targets glass classes that Orca’s UI primitives still use', () => {
    const css = readFileSync(join(__dirname, 'window-appearance.css'), 'utf8')
    const targets = [...css.matchAll(/\[class\*='([^']+)'\]/g)].map((match) => match[1])
    const uiDir = join(__dirname, '../../../../../renderer/src/components/ui')
    const primitives = readdirSync(uiDir)
      .filter((name) => name.endsWith('.tsx'))
      .map((name) => readFileSync(join(uiDir, name), 'utf8'))
      .join('\n')
    expect(targets.length).toBeGreaterThan(0)
    for (const target of targets) {
      expect(primitives, target).toContain(target)
    }
  })

  it.each([
    ['assets/main.css', '.titlebar-left {'],
    ['assets/main.css', '.titlebar-left-floating {'],
    ['components/sidebar/index.tsx', 'data-sidebar-resize-handle'],
    ['lib/left-sidebar-appearance.ts', "'--worktree-sidebar-border'"]
  ])(
    'draws borders and the sidebar seam from hooks upstream still has: %s has %s',
    (file, hook) => {
      const source = readFileSync(join(__dirname, '../../../../../renderer/src', file), 'utf8')
      expect(source).toContain(hook)
    }
  )
})
