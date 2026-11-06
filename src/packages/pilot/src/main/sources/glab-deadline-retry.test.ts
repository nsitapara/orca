import { describe, expect, it } from 'vitest'
import { retryDeadlineKill } from './glab-deadline-retry'

// The error exec-file-capture throws for a deadline kill, an abort, and a glab that answered with an error.
const deadline = () => Object.assign(new Error('glab timed out.'), { killed: true, code: null })
const aborted = () =>
  Object.assign(new Error('The operation was aborted.'), { name: 'AbortError', killed: true })
const rejected = () => Object.assign(new Error('glab: 404 Not Found'), { killed: false, code: 1 })

describe('retryDeadlineKill', () => {
  it.each([
    { name: 'answers at once', errors: [], calls: 1, result: 'ok' },
    { name: 'a deadline kill is tried once more', errors: [deadline], calls: 2, result: 'ok' },
    {
      name: 'a second deadline kill is thrown',
      errors: [deadline, deadline],
      calls: 2,
      result: 'glab timed out.'
    },
    {
      name: 'an abort is not retried',
      errors: [aborted],
      calls: 1,
      result: 'The operation was aborted.'
    },
    {
      name: "glab's own error is not retried",
      errors: [rejected],
      calls: 1,
      result: 'glab: 404 Not Found'
    }
  ])('$name', async ({ errors, calls, result }) => {
    let n = 0
    const call = async () => {
      const fail = errors[n++]
      if (fail) {
        throw fail()
      }
      return 'ok'
    }
    const got = await retryDeadlineKill(call).catch((e: Error) => e.message)
    expect([got, n]).toEqual([result, calls])
  })
})
