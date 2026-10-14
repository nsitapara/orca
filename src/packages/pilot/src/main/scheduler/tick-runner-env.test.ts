import { describe, expect, it } from 'vitest'
import type { ItemDecision } from '../../shared/api-types'
import { testDefinition } from '../../shared/definition/__fixtures__/definition'
import { EMPTY_PEOPLE } from '../../shared/people'
import { fakeFieldDeps, testItem } from '../fields/__fixtures__/field-deps'
import { PilotStore } from '../store/store'
import { runTick, type TickDeps } from './tick-runner'

const def = testDefinition({
  id: 'env-job',
  file: '/a/env-job.yaml',
  name: 'Env job',
  oncePer: '{mr.iid}'
})

function setup() {
  const store = PilotStore.open(':memory:')
  const previewed: ItemDecision[][] = []
  const launched: string[] = []
  const deps: TickDeps = {
    store,
    now: () => Date.UTC(2026, 9, 10, 19, 10),
    resolveRepo: async () => ({ name: 'r', id: 'r', path: '/repo', base: 'origin/dev' }),
    sources: {
      list: async () => ({
        items: [testItem({ key: 'mr:1', label: '!1', fields: { 'mr.iid': 1 } })],
        warnings: []
      }),
      scope: () => null
    },
    fields: fakeFieldDeps(),
    ask: {
      store,
      now: () => 0,
      inbox: { store, now: () => 0, definitions: () => [], people: () => EMPTY_PEOPLE }
    },
    launch: async (req) => {
      launched.push(req.decision.key)
      return { terminalHandle: 't', paneKey: 'p' }
    },
    previewEnvs: async (_def, decisions) => {
      previewed.push(decisions)
      for (const d of decisions) {
        d.workspace = 'would run in place · stack never'
        d.reason = `${d.reason} · ${d.workspace}`
      }
    }
  }
  return { deps, store, previewed, launched }
}

describe('runTick with an env preview', () => {
  it('a dry run previews once and records the preview in the item reason', async () => {
    const { deps, store, previewed } = setup()
    const result = await runTick(def, EMPTY_PEOPLE, deps, { dryRun: true })
    expect(previewed).toHaveLength(1)
    expect(previewed[0].map((d) => d.key)).toEqual(['mr:1'])
    expect(store.tickItems(result.tickId)[0].reason).toContain('would run in place · stack never')
  })

  it('a real tick never previews', async () => {
    const { deps, previewed, launched } = setup()
    await runTick(def, EMPTY_PEOPLE, deps, { dryRun: false })
    expect(previewed).toHaveLength(0)
    expect(launched).toEqual(['mr:1'])
  })
})
