// @vitest-environment happy-dom
import { describe, expect, it, vi } from 'vitest'
import i18next from 'i18next'
import { attachPilotRenderer } from './attach-renderer'
import { pilotStore, registerPilotStore } from './store'

describe('attachPilotRenderer', () => {
  it('rewrites the product name in resolved strings and defaults', async () => {
    const i18n = i18next.createInstance()
    await i18n.init({ lng: 'en', resources: { en: { translation: { a: 'Quit Orca' } } } })
    attachPilotRenderer({ i18n, doc: document })
    expect(i18n.t('a')).toBe('Quit Pilot')
    expect(i18n.t('missing', { defaultValue: 'About Orca' })).toBe('About Pilot')
  })

  it('drops "left" from the sidebar appearance setting, which styles both sidebars', async () => {
    const i18n = i18next.createInstance()
    await i18n.init({ lng: 'en', resources: { en: { translation: {} } } })
    attachPilotRenderer({ i18n, doc: document })
    expect(i18n.t('a', { defaultValue: 'Left Sidebar Appearance' })).toBe('Sidebar Appearance')
    expect(
      i18n.t('b', {
        defaultValue: 'Make the left sidebar match your terminal, stay default, or use a tint.'
      })
    ).toBe('Make both sidebars match your terminal, stay default, or use a tint.')
    const elsewhere = 'Show the Tasks button at the top of the left sidebar.'
    expect(i18n.t('c', { defaultValue: elsewhere })).toBe(elsewhere)
  })

  it('does not throw on object resources and keeps their shape', async () => {
    const i18n = i18next.createInstance()
    const obj = { n: 1, x: 'Orca' }
    await i18n.init({ lng: 'en', resources: { en: { translation: { obj } } } })
    attachPilotRenderer({ i18n, doc: document })
    expect(i18n.t('obj', { returnObjects: true })).toEqual({ n: 1, x: 'Pilot' })
  })

  it('sets the document title', () => {
    document.title = 'Orca'
    attachPilotRenderer({ i18n: i18next.createInstance(), doc: document })
    expect(document.title).toBe('Pilot')
  })

  // main.tsx calls attach at the top level, so a throw would blank the whole UI (R13).
  it('logs a failure and returns, leaving the app working', () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    const i18n = {
      use: () => {
        throw new Error('i18n not ready')
      },
      options: {}
    }
    const store = { getState: () => ({ rightSidebarOpen: true, setRightSidebarOpen: () => {} }) }
    expect(() => attachPilotRenderer({ i18n, doc: document, store })).not.toThrow()
    expect(error).toHaveBeenCalledWith('[pilot] renderer attach failed: i18n not ready')
    // What ran before the failure stays in place: the sidebar hooks still find the store.
    expect(pilotStore()).toBe(store)
    registerPilotStore(null)
    error.mockRestore()
  })

  it('registers the app store for the sidebar hooks', () => {
    const store = { getState: () => ({ rightSidebarOpen: true, setRightSidebarOpen: () => {} }) }
    attachPilotRenderer({ i18n: i18next.createInstance(), doc: document, store })
    expect(pilotStore()).toBe(store)
    registerPilotStore(null)
  })
})
