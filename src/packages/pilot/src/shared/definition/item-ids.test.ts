import { describe, expect, it } from 'vitest'
import { fedIdProblem, MAX_FED_ID_LENGTH } from './item-ids'

describe('fedIdProblem: an id one stage may hand another, by the receiving stage’s item kind', () => {
  it.each([
    ['a Linear id', 'linear_ticket', 'WEB-2123', null],
    ['a team key with digits', 'linear_ticket', 'W3B-1', null],
    ['lower case', 'linear_ticket', 'web-1', 'not a Linear id like WEB-123'],
    ['no number', 'linear_ticket', 'WEB-', 'not a Linear id like WEB-123'],
    ['a word', 'linear_ticket', 'none', 'not a Linear id like WEB-123'],
    [
      'too long',
      'linear_ticket',
      `W${'A'.repeat(MAX_FED_ID_LENGTH)}-1`,
      `longer than ${MAX_FED_ID_LENGTH} characters`
    ],
    ['another kind takes any printable id', 'merge_request', '1561', null],
    [
      'but never a control character',
      'merge_request',
      'a\u0007',
      'not printable text without spaces'
    ],
    ['a receiver that is not loaded', null, 'WEB-1', 'its stage is not loaded']
  ] as const)('%s: %s %s → %s', (_name, kind, id, problem) => {
    expect(fedIdProblem(kind, id)).toBe(problem)
  })
})
