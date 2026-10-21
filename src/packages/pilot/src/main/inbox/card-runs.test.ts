import { describe, expect, it } from 'vitest'
import { PilotStore } from '../store/store'
import { cardRuns } from './card-runs'

describe('cardRuns', () => {
  it('gives each card its run with its steps, once per run, and nothing for a card without one', () => {
    const store = PilotStore.open(':memory:')
    store.runs.create({
      id: 'r1',
      automationId: 'a',
      tickId: null,
      itemKey: '!1',
      itemLabel: '!1',
      worktreePath: null,
      startedAt: 1,
      status: 'needs_you'
    })
    store.runs.createStep({
      runId: 'r1',
      idx: 0,
      name: 'fix',
      agent: 'claude',
      skill: null,
      startedAt: 1
    })
    const runs = cardRuns(store, [
      { runId: 'r1' },
      { runId: 'r1' },
      { runId: null },
      { runId: 'gone' }
    ])
    expect(Object.keys(runs)).toEqual(['r1'])
    expect(runs.r1.steps.map((s) => s.name)).toEqual(['fix'])
    expect(runs.r1.fields).toBeUndefined()
    store.close()
  })

  it("carries its item's MR and branch fields, and none of the rest, for the card's place line", () => {
    const store = PilotStore.open(':memory:')
    const tickId = store.startTick('a', 1)
    const fields = {
      'mr.iid': 1633,
      'mr.title': 'Ticket priority',
      'mr.web_url': 'https://gitlab.com/g/web-platform/-/merge_requests/1633',
      'mr.state': 'open',
      'mr.draft': false,
      'mr.pipeline_status': 'success',
      'mr.branch': 'web-2122-ticket-priority',
      'mr.review_block': 'a long block',
      'repo.path': '/r'
    }
    store.recordDecisions(
      tickId,
      [
        {
          key: 'mr:1633',
          label: '!1633',
          verdict: 'started',
          reason: '',
          checks: [],
          onceKey: 'k',
          fields
        }
      ],
      new Map()
    )
    store.runs.create({
      id: 'r1',
      automationId: 'a',
      tickId,
      itemKey: 'mr:1633',
      itemLabel: '!1633',
      worktreePath: null,
      startedAt: 1,
      status: 'needs_you'
    })
    expect(cardRuns(store, [{ runId: 'r1' }]).r1.fields).toEqual({
      'mr.iid': 1633,
      'mr.title': 'Ticket priority',
      'mr.web_url': 'https://gitlab.com/g/web-platform/-/merge_requests/1633',
      'mr.state': 'open',
      'mr.draft': false,
      'mr.pipeline_status': 'success',
      'mr.branch': 'web-2122-ticket-priority'
    })
    store.close()
  })
})
