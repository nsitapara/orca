import type { HandlerGroup } from '../../../../cli/handler-group-manifest'

export const PILOT_HANDLER_GROUPS: readonly HandlerGroup[] = [
  {
    name: 'pilot',
    keys: ['automations status'],
    load: async () => (await import('./handlers.js')).PILOT_HANDLERS
  }
]
