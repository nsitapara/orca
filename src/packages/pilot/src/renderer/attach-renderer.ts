import { i18n as appI18n } from '@/i18n/i18n'
import { useAppStore } from '@/store'
import { pilotBrand } from '../shared/brand'
import { pilotSidebarAppearanceLabel } from './sidebar/sidebar-appearance-labels'
import { registerPilotStore, type PilotStore } from './store'

export type PilotI18nPostProcessor = {
  type: 'postProcessor'
  name: string
  process: (value: unknown) => unknown
}

export type I18nLike = {
  use(module: PilotI18nPostProcessor): unknown
  options: { postProcess?: string | readonly string[] | false }
}

function asList(value: string | readonly string[] | false | undefined): string[] {
  if (typeof value === 'string') {
    return [value]
  }
  return value ? [...value] : []
}

// Hook target: src/renderer/src/main.tsx (pilot-hook: renderer). Rebrands every translated string, and
// relabels the sidebar appearance setting, through one i18next post-processor, so none of Orca's 5,625
// catalog strings is edited.
// It runs at the top level of main.tsx, before React renders, so a throw here would blank the whole
// app: Pilot fails soft (R13), logs, and Orca's UI keeps working.
export function attachPilotRenderer(
  deps: { i18n?: I18nLike; doc?: Document; store?: PilotStore } = {}
): void {
  try {
    registerPilotStore(deps.store ?? useAppStore)
    const i18n = deps.i18n ?? (appI18n as unknown as I18nLike)
    i18n.use({
      type: 'postProcessor',
      name: 'pilot-brand',
      process: (value: unknown) =>
        typeof value === 'string' ? pilotSidebarAppearanceLabel(pilotBrand(value)) : value
    })
    const list = asList(i18n.options.postProcess)
    if (!list.includes('pilot-brand')) {
      i18n.options.postProcess = [...list, 'pilot-brand']
    }
    const doc = deps.doc ?? globalThis.document
    if (doc) {
      doc.title = pilotBrand(doc.title || 'Orca')
    }
  } catch (error) {
    console.error(
      `[pilot] renderer attach failed: ${error instanceof Error ? error.message : String(error)}`
    )
  }
}
