import { describe, expect, it } from 'vitest'
import { agentUsageState } from './agent-usage'
import { stateReader } from './test-reader'

const FOLDER = '08 · Tally token usage by job'

describe('agentUsageState', () => {
  it("copies 08's last usage.json to usage-legacy.json beside it, the hand-over marker", () => {
    const plan = agentUsageState.plan(
      stateReader({ note: (rel) => (rel === `${FOLDER}/usage.json` ? '{"rows": []}' : null) })
    )
    expect(plan).toMatchObject({
      automationId: 'agent-usage',
      handled: [],
      sessions: [],
      files: [{ from: `/vault/${FOLDER}/usage.json`, to: `/vault/${FOLDER}/usage-legacy.json` }],
      notes: [
        "After --apply Pilot writes this folder's usage.json itself, so apply it only at go-live"
      ]
    })
  })

  it('says so when 08 never wrote a usage.json', () => {
    const plan = agentUsageState.plan(stateReader())
    expect(plan.files).toEqual([])
    expect(plan.notes).toEqual([`/vault/${FOLDER}/usage.json not found; no history to hand over`])
  })
})
