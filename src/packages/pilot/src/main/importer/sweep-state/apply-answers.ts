import { oneLine } from '../../inbox/card'
import { emptyPlan } from './plans'
import type { SweepStateMapper } from './types'

const SENT = 'answers/sent.json'
// The vault import (removed after it ran on 2026-10-12) stored an answer as oneLine(answer).slice(0, 4000); the match
// must see the same text.
const MAX_ANSWER_CHARS = 4000

// 12's answers/sent.json, { "<note path>": [[key, answer], …] }: each answer apply.py already sent to a session is
// marked dispatched on the inbox item Task 27b imported from that card, so Pilot never sends it a second time. A
// changed answer isn't in the file, so it still goes, as apply.py would send it.
export const applyAnswersMapper: SweepStateMapper = {
  automationId: 'apply-answers',
  plan(read) {
    const plan = emptyPlan('apply-answers')
    const data = read.json(SENT)
    if (data === null) {
      return plan
    }
    if (typeof data !== 'object' || Array.isArray(data)) {
      plan.notes.push(`${SENT}: expected a JSON object`)
      return plan
    }
    const dispatched: NonNullable<typeof plan.dispatched> = []
    for (const [note, pairs] of Object.entries(data as Record<string, unknown>)) {
      if (!Array.isArray(pairs)) {
        plan.notes.push(`${SENT}: ${note} isn't a list of [key, answer]; skipped`)
        continue
      }
      for (const pair of pairs) {
        if (
          Array.isArray(pair) &&
          pair.length === 2 &&
          typeof pair[0] === 'string' &&
          typeof pair[1] === 'string'
        ) {
          dispatched.push({
            vaultRef: `${note}#${pair[0]}`,
            answer: oneLine(pair[1]).slice(0, MAX_ANSWER_CHARS)
          })
        } else {
          plan.notes.push(`${SENT}: ${note} has an entry that isn't [key, answer]; skipped`)
        }
      }
    }
    return { ...plan, dispatched }
  }
}
