import { describe, expect, it } from 'vitest'
import { mrFeedbackState } from './mr-feedback'
import { stateReader } from './test-reader'

const read = stateReader({
  json: (rel) =>
    rel === 'mr-feedback/tabs.json' ? { '/wt/web-1711': 'term_fb', '/wt/web-1493': '' } : null
})

describe('mrFeedbackState', () => {
  it("imports the sweep's feedback tabs and no handled keys", () => {
    const plan = mrFeedbackState.plan(read)
    expect(plan).toMatchObject({
      automationId: 'mr-feedback',
      handled: [],
      sessions: [
        {
          worktreePath: '/wt/web-1711',
          terminalHandle: 'term_fb',
          agent: 'claude',
          label: 'web-1711'
        }
      ],
      files: []
    })
    expect(plan.notes).toContain('mr-feedback/tabs.json: skipped /wt/web-1493: ""')
  })

  it('imports Codex tabs too', () => {
    const codex = stateReader({
      json: (rel) => (rel === 'mr-feedback/tabs-codex.json' ? { '/wt/web-7': 'term_cx' } : null)
    })
    expect(mrFeedbackState.plan(codex).sessions).toEqual([
      { worktreePath: '/wt/web-7', terminalHandle: 'term_cx', agent: 'codex', label: 'web-7' }
    ])
  })
})
