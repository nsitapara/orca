import { describe, expect, it, vi } from 'vitest'
import { testDefinition, testStep } from '../../shared/definition/__fixtures__/definition'
import { queuedPreparation, PREPARATION_LEASE_MS } from '../../shared/preparation'
import { PilotStore } from '../store/store'
import { launchAgentStep, type AgentStepDeps, type AgentStepRequest } from './agent-step'
import { stopCancelledPreparations } from './preparation-worker'

const definition = testDefinition({
  id: 'prepare',
  items: { kind: 'inbox_preparation', where: {}, match: [], customFields: [] },
  steps: [testStep({ name: 'prepare', skill: 'prepare-inbox-item-context' })]
})

function setup() {
  const store = PilotStore.open(':memory:')
  store.inbox.add({
    id: 'item',
    automationId: 'origin',
    runId: null,
    stepIdx: null,
    itemKey: 'mr:1',
    worktreePath: '/wt',
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
      { key: 'decision', context: 'Investigate', requirements: ['context'] },
      1
    )
  })
  store.runs.create({
    id: 'worker',
    automationId: definition.id,
    tickId: null,
    itemKey: 'item',
    itemLabel: 'Decision',
    worktreePath: '/wt',
    startedAt: 1
  })
  const req: AgentStepRequest = {
    runId: 'worker',
    definition,
    stepIdx: 0,
    itemKey: 'item',
    label: 'Decision',
    fields: { 'preparation.item_id': 'item', 'preparation.revision': 1 },
    workspace: {
      kind: 'item_worktree',
      path: '/wt',
      worktreeId: null,
      selector: 'path:/wt',
      created: false
    }
  }
  const launchTerminal = vi.fn(async () => ({ handle: 'terminal', paneKey: 'pane' }))
  const deps: AgentStepDeps = {
    launchTerminal,
    modeText: async () => null,
    newSessionId: () => '00000000-0000-4000-8000-00000000000a',
    now: () => 10,
    transcriptExists: async () => true
  }
  return { store, req, deps, launchTerminal }
}

describe('preparation worker launch and cancellation', () => {
  it('does not launch if answered during asynchronous launch preparation', async () => {
    const { store, req, deps, launchTerminal } = setup()
    deps.modeText = async () => {
      store.inbox.update('item', { status: 'answered' }, 9)
      return null
    }
    await expect(launchAgentStep(store, req, deps)).rejects.toThrow('stale')
    expect(launchTerminal).not.toHaveBeenCalled()
    expect(store.inbox.get('item')?.preparation?.attempt).toBe(0)
    store.close()
  })

  it.each(['answered', 'expired'] as const)(
    'stops a %s worker before allowing recovery',
    async (ending) => {
      const { store, req, deps } = setup()
      await launchAgentStep(store, req, deps)
      expect(store.inbox.get('item')?.preparation).toMatchObject({
        state: 'generating',
        runId: 'worker',
        attempt: 1
      })
      let at = 20
      if (ending === 'answered') {
        store.inbox.update('item', { status: 'answered' }, at)
      } else {
        at += PREPARATION_LEASE_MS
      }
      const closeTerminal = vi.fn(async () => {})
      await stopCancelledPreparations({
        store,
        now: () => at,
        definitionFor: () => definition,
        closeTerminal,
        log: () => {}
      })
      expect(closeTerminal).toHaveBeenCalledWith('terminal')
      expect(store.runs.get('worker')?.status).toBe('cancelled')
      store.close()
    }
  )

  it('blocks automatic recovery when a launched terminal cannot be tracked', async () => {
    const { store, req, deps } = setup()
    deps.launchTerminal = async () => ({ handle: 'orphan' })
    await expect(launchAgentStep(store, req, deps)).rejects.toThrow('no pane to watch')
    expect(store.inbox.get('item')?.preparation).toMatchObject({
      state: 'blocked',
      error: expect.stringContaining('orphan')
    })
    expect(store.inboxPreparations.listEligible(PREPARATION_LEASE_MS + 20)).toEqual([])
    store.close()
  })

  it('retains the worktree lock when stopping the terminal fails', async () => {
    const { store, req, deps } = setup()
    await launchAgentStep(store, req, deps)
    store.inbox.update('item', { status: 'answered' }, 20)
    await stopCancelledPreparations({
      store,
      now: () => 20,
      definitionFor: () => definition,
      closeTerminal: async () => {
        throw new Error('still alive')
      },
      log: () => {}
    })
    expect(store.runs.get('worker')?.status).toBe('running')
    store.close()
  })
})
