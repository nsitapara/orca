// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest'
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

  it('registers the app store for the sidebar hooks', () => {
    const store = { getState: () => ({ rightSidebarOpen: true, setRightSidebarOpen: () => {} }) }
    attachPilotRenderer({ i18n: i18next.createInstance(), doc: document, store })
    expect(pilotStore()).toBe(store)
    registerPilotStore(null)
  })
})
