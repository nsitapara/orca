// @vitest-environment happy-dom
import { renderHook } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { getDefaultSettings } from '../../../../../shared/constants'
import type { GlobalSettings } from '../../../../../shared/global-settings-types'
import { registerPilotStore } from '../store'
import { usePilotRightSidebarAppearance } from './right-sidebar-appearance'

const MOCHA = { background: '#1e1e2e', foreground: '#cdd6f4' }

function settings(patch: Partial<GlobalSettings>): GlobalSettings {
  return { ...getDefaultSettings('/tmp'), terminalColorOverrides: MOCHA, ...patch }
}

function renderSidebar(initial: GlobalSettings) {
  const el = document.createElement('div')
  const ref = { current: el }
  const hook = renderHook(
    ({ value }: { value: GlobalSettings }) =>
      usePilotRightSidebarAppearance(ref, (select) => select({ settings: value })),
    { initialProps: { value: initial } }
  )
  return { el, hook }
}

describe('usePilotRightSidebarAppearance', () => {
  afterEach(() => registerPilotStore(null))

  it.each([
    [
      'match-terminal paints the terminal theme',
      'match-terminal',
      MOCHA.background,
      MOCHA.background
    ],
    [
      'tinted mixes the tint like the left sidebar',
      'tinted',
      expect.stringContaining('color-mix'),
      ''
    ],
    ['default leaves Orca’s sidebar surface', 'default', '', '']
  ] as const)('%s', (_name, mode, sidebar, background) => {
    registerPilotStore({ getState: () => ({ rightSidebarOpen: true, setRightSidebarOpen() {} }) })
    const { el } = renderSidebar(settings({ leftSidebarAppearanceMode: mode }))
    expect(el.style.getPropertyValue('--sidebar')).toEqual(sidebar)
    expect(el.style.getPropertyValue('--background')).toBe(background)
  })

  it('clears the variables when the mode goes back to default', () => {
    registerPilotStore({ getState: () => ({ rightSidebarOpen: true, setRightSidebarOpen() {} }) })
    const { el, hook } = renderSidebar(settings({ leftSidebarAppearanceMode: 'match-terminal' }))
    hook.rerender({ value: settings({ leftSidebarAppearanceMode: 'default' }) })
    expect(el.style.getPropertyValue('--sidebar')).toBe('')
    expect(el.style.getPropertyValue('--foreground')).toBe('')
  })

  it('is inert when no store is registered', () => {
    const { el } = renderSidebar(settings({ leftSidebarAppearanceMode: 'match-terminal' }))
    expect(el.style.getPropertyValue('--sidebar')).toBe('')
  })
})
