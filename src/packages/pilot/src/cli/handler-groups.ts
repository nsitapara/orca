import type { HandlerGroup } from '../../../../cli/handler-group-manifest'
import { ANSWERS_COMMAND_KEYS } from './answers-specs'

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
    name: 'pilot-import',
    keys: ['automations import-state'],
    load: async () => (await import('./handlers-import.js')).IMPORT_HANDLERS
  },
  {
    name: 'pilot-automation-files',
    keys: [
      'automations list-yaml',
      'automations show-yaml',
      'automations reload',
      'automations enable',
      'automations disable'
    ],
    load: async () => (await import('./handlers-automations.js')).AUTOMATION_FILE_HANDLERS
  },
  {
    name: 'pilot-run',
    keys: ['run output', 'run event'],
    load: async () => (await import('./handlers-run.js')).RUN_HANDLERS
  },
  {
    name: 'pilot-inbox',
    keys: ['inbox add', 'inbox list', 'inbox show', 'inbox set-details', 'inbox answer'],
    load: async () => (await import('./handlers-inbox.js')).INBOX_HANDLERS
  },
  {
    name: 'pilot-answers',
    keys: ANSWERS_COMMAND_KEYS,
    load: async () => (await import('./answers-handlers.js')).ANSWERS_HANDLERS
  },
  {
    name: 'pilot-spend',
    keys: ['automations spend', 'automations usage-report'],
    load: async () => (await import('./spend.js')).PILOT_SPEND_HANDLERS
  }
]
