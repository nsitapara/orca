import type { ItemFields } from '../../../shared/api-types'
import { parseAutomationYaml } from '../../../shared/definition/parse'
import type { AutomationDefinition } from '../../../shared/definition/types'
import { parsePeopleYaml } from '../../../shared/people'
import { addInboxItem } from '../../inbox/inbox-add'
import type { InboxDeps } from '../../inbox/inbox-service'
import { PilotStore } from '../../store/store'

// Tests only: a store with the automations a mark_ready card can sit beside, and their runs and cards.
function definition(id: string, name: string, kind: string): AutomationDefinition {
  const parsed = parseAutomationYaml(
    `name: "${name}"\nrepo: web-platform\nschedule: manual\nitems: { kind: ${kind} }\nsteps: [ { agent: claude, prompt: x } ]\ninbox: nish\n`,
    `/a/${id}.yaml`
  )
  if (!parsed.ok) {
    throw new Error(`fixture ${id}: ${JSON.stringify(parsed)}`)
  }
  return parsed.definition
}

export const DEFINITIONS: AutomationDefinition[] = [
  definition('review-branch-code', '03 · Review and fix branch code', 'worktree'),
  definition('ui-qa-overnight', '04 · Test branch UIs overnight', 'worktree'),
  definition('fix-failed-ci', '05 · Fix failed CI on my MRs', 'merge_request'),
  definition('mr-feedback', '06 · Address reviewer feedback on my MRs', 'merge_request'),
  definition('linear-todo', 'M01 · Start my Todo Linear tickets', 'linear_ticket'),
  definition('mr-next-steps', 'M02 · Report next steps for my MRs', 'merge_request')
]

const people = parsePeopleYaml('people:\n  - { id: nish, name: Nish, gitlab: nish8 }\n')

export function callerStore() {
  const store = PilotStore.open(':memory:')
  let n = 0
  const inbox: InboxDeps = {
    store,
    now: () => 1000,
    definitions: () => DEFINITIONS,
    people: () => (people.ok ? people.directory : (null as never)),
    newId: () => `in_${String(++n).padStart(16, '0')}`
  }
  const decision = (key: string, fields: ItemFields) => ({
    key,
    label: key,
    verdict: 'started' as const,
    reason: '',
    checks: [],
    onceKey: key,
    fields
  })
  // A tick of an automation at a time, on items with these fields, that started no run.
  const tick = (automationId: string, at: number, items: [string, ItemFields][]): void => {
    const id = store.startTick(automationId, at)
    store.recordDecisions(
      id,
      items.map(([key, fields]) => decision(key, fields)),
      new Map()
    )
  }
  // A run with no tick behind it (imported, or its tick aged out): fieldsForRun reads nothing for it.
  const bareRun = (
    id: string,
    automationId: string,
    itemKey: string,
    worktreePath: string | null
  ) =>
    store.runs.create({
      id,
      automationId,
      tickId: null,
      itemKey,
      itemLabel: itemKey,
      worktreePath,
      startedAt: 1
    })
  // A run that a tick started on an item with these fields (what fieldsForRun reads back).
  const run = (
    id: string,
    automationId: string,
    itemKey: string,
    worktreePath: string | null,
    fields: ItemFields,
    at = 1
  ): void => {
    const tickId = store.startTick(automationId, at)
    store.runs.create({
      id,
      automationId,
      tickId,
      itemKey,
      itemLabel: itemKey,
      worktreePath,
      startedAt: at
    })
    store.recordDecisions(tickId, [decision(itemKey, fields)], new Map([[itemKey, id]]))
  }
  // A card that run adds, or with no run one named by `over` (automation, item, worktree); returns its id.
  const card = (
    runId: string | null,
    over: Partial<Parameters<typeof addInboxItem>[1]> = {}
  ): string => {
    const added = addInboxItem(inbox, {
      ...(runId ? { runId } : {}),
      type: 'question',
      title: `Card ${n + 1}?`,
      options: ['A', 'B'],
      ...over
    })
    if (!added.id) {
      throw new Error(`fixture card: ${added.refused ?? 'not added'}`)
    }
    return added.id
  }
  return { store, inbox, run, tick, bareRun, card }
}
