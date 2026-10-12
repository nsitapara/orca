import { describe, expect, it } from 'vitest'
import { applyAnswersMapper } from './apply-answers'
import { stateReader } from './test-reader'

const FILE = 'answers/sent.json'
const NOTE = '/vault/Agent Work/Automations/03 · Review and fix branch code/web-2118.md'

function reader(content: unknown) {
  return stateReader({ json: (rel) => (rel === FILE ? content : null) })
}

describe('12 state import', () => {
  it('marks every sent (key, answer) pair dispatched on its imported card', () => {
    const plan = applyAnswersMapper.plan(
      reader({
        [NOTE]: [
          ['a1b2c3d4e5f60718', 'Approve'],
          ['0f1e2d3c4b5a6978', 'keep']
        ]
      })
    )
    expect(plan.dispatched).toEqual([
      { vaultRef: `${NOTE}#a1b2c3d4e5f60718`, answer: 'Approve' },
      { vaultRef: `${NOTE}#0f1e2d3c4b5a6978`, answer: 'keep' }
    ])
  })

  it.each([
    [
      'a note whose value is not a list',
      { [NOTE]: 'x' },
      [`${FILE}: ${NOTE} isn't a list of [key, answer]; skipped`]
    ],
    [
      'an entry that is not a pair',
      { [NOTE]: [['only-key']] },
      [`${FILE}: ${NOTE} has an entry that isn't [key, answer]; skipped`]
    ]
  ])('reports %s and imports nothing for it', (_name, content, notes) => {
    const plan = applyAnswersMapper.plan(reader(content))
    expect(plan.dispatched).toEqual([])
    expect(plan.notes).toEqual(notes)
  })
})
