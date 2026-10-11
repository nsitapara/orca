import type { HandlerGroup } from '../../../../cli/handler-group-manifest'

export const PILOT_HANDLER_GROUPS: readonly HandlerGroup[] = [
  {
    name: 'pilot',
    keys: [
      'automations status',
      'automations validate',
      'automations dry-run',
      'automations tick',
      'automations activity'
    ],
    load: async () => (await import('./handlers.js')).PILOT_HANDLERS
  },
  {
    name: 'pilot-run',
    keys: ['run output', 'run event'],
    load: async () => (await import('./handlers-run.js')).RUN_HANDLERS
  }
]
