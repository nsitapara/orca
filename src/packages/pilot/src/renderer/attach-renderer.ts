import { i18n as appI18n } from '@/i18n/i18n'
import { useAppStore } from '@/store'
import { pilotBrand } from '../shared/brand'
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

// Hook target: src/renderer/src/main.tsx (pilot-hook: renderer). Rebrands every translated string
// through one i18next post-processor, so none of Orca's 5,625 catalog strings is edited.
export function attachPilotRenderer(
  deps: { i18n?: I18nLike; doc?: Document; store?: PilotStore } = {}
): void {
  registerPilotStore(deps.store ?? useAppStore)
  const i18n = deps.i18n ?? (appI18n as unknown as I18nLike)
  i18n.use({
    type: 'postProcessor',
    name: 'pilot-brand',
    process: (value: unknown) => (typeof value === 'string' ? pilotBrand(value) : value)
  })
  const list = asList(i18n.options.postProcess)
  if (!list.includes('pilot-brand')) {
    i18n.options.postProcess = [...list, 'pilot-brand']
  }
  const doc = deps.doc ?? globalThis.document
  if (doc) {
    doc.title = pilotBrand(doc.title || 'Orca')
  }
}
