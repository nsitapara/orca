import { describe, expect, it } from 'vitest'
import { testDefinition } from '../../shared/definition/__fixtures__/definition'
import { queuedPreparation, PREPARATION_LEASE_MS } from '../../shared/preparation'
import { PilotStore } from '../store/store'
import { sourceContext } from './__fixtures__/source-context'
import { inboxPreparationSource } from './inbox-preparations'

function setup(head?: string) {
  const store = PilotStore.open(':memory:')
  store.definitions.saveValid(
    testDefinition({ id: 'origin' }),
    'name: Origin\nrepo: web-platform\nschedule: manual\nsteps:\n  - agent: claude\n    prompt: Investigate\n',
    1
  )
  store.inbox.add({
    id: 'item',
    automationId: 'origin',
    runId: null,
    stepIdx: null,
    itemKey: 'mr:1',
    worktreePath: '/repo',
    person: 'nish',
    type: 'question',
    title: 'Decision',
    context: 'Context',
    options: [],
    suggested: null,
    detailsMd: null,
    action: null,
    actionArgs: null,
    digest: 'digest',
    createdAt: 1,
    source: 'engine',
    vaultRef: null,
    preparation: queuedPreparation(
      {
        key: 'decision',
        context: 'Investigate saved evidence',
        requirements: ['context'],
        ...(head ? { head } : {})
      },
      1
    )
  })
  return { store, source: inboxPreparationSource(store, async () => []) }
}

describe('inbox preparation source', () => {
  it('isolates repos, lists the durable prompt, and excludes answered items', async () => {
    const { store, source } = setup()
    const first = await source.list(sourceContext(), {})
    expect(first.items.map((item) => item.fields)).toEqual([
      expect.objectContaining({
        'preparation.item_id': 'item',
        'preparation.context': 'Investigate saved evidence',
        'preparation.revision': 1,
        'preparation.attempt': 1,
        'preparation.origin_automation': 'origin'
      })
    ])
    expect(
      (
        await source.list(
          sourceContext({ repo: { name: 'other', path: '/other', id: 'other', base: null } }),
          {}
        )
      ).items
    ).toEqual([])
    store.inbox.update('item', { status: 'answered' }, 2)
    expect((await source.list(sourceContext(), {})).items).toEqual([])
    store.close()
  })

  it.each([
    ['the head its producer sent', '9c1e2f0', '9c1e2f0'],
    ['no head', undefined, null]
  ])('lists preparation.head: %s', async (_name, head, expected) => {
    const { store, source } = setup(head)
    const { items } = await source.list(sourceContext(), {})
    expect(items[0].fields['preparation.head']).toBe(expected)
    store.close()
  })

  it('retries independently of discovery only after the previous worker has stopped', async () => {
    const { store, source } = setup()
    store.runs.create({
      id: 'worker',
      automationId: 'prepare',
      tickId: null,
      itemKey: 'item',
      itemLabel: 'Decision',
      worktreePath: '/repo',
      startedAt: 1
    })
    store.inboxPreparations.claim('item', 1, 'worker', 0, 1)
    const ctx = sourceContext({ now: PREPARATION_LEASE_MS + 2 })
    expect((await source.list(ctx, {})).items).toEqual([])
    store.runs.update('worker', { status: 'cancelled' })
    expect((await source.list(ctx, {})).items[0].fields['preparation.attempt']).toBe(2)
    // Listing/dry run never mutates the queue's lease or retry history.
    expect(store.inbox.get('item')?.preparation?.state).toBe('generating')
    store.close()
  })
})
