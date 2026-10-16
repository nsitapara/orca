import type { ItemFields } from '../../../shared/api-types'
import { parseAutomationYaml } from '../../../shared/definition/parse'
import type { AutomationDefinition } from '../../../shared/definition/types'
import { parsePeopleYaml } from '../../../shared/people'
import { addInboxItem } from '../../inbox/inbox-add'
import type { InboxDeps } from '../../inbox/inbox-service'
import { PilotStore } from '../../store/store'

// Tests only: a store with the automations a mark_ready or post_review card can sit beside, and their runs and cards.
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
  // A run that a tick started on an item with these fields (what fieldsForRun reads back).
  const run = (
    id: string,
    automationId: string,
    itemKey: string,
    worktreePath: string | null,
    fields: ItemFields
  ): void => {
    const tick = store.startTick(automationId, 1)
    store.runs.create({
      id,
      automationId,
      tickId: tick,
      itemKey,
      itemLabel: itemKey,
      worktreePath,
      startedAt: 1
    })
    const decision = {
      key: itemKey,
      label: itemKey,
      verdict: 'started' as const,
      reason: '',
      checks: [],
      onceKey: itemKey,
      fields
    }
    store.recordDecisions(tick, [decision], new Map([[itemKey, id]]))
  }
  // A card that run adds; returns its id.
  const card = (runId: string, over: Partial<Parameters<typeof addInboxItem>[1]> = {}): string => {
    const added = addInboxItem(inbox, {
      runId,
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
  return { store, inbox, run, card }
}
