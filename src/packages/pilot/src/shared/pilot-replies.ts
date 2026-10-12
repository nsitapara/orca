import { START_RUN_ONLY } from './answers/route'

// Pilot's own words under a card (a re-ask or a hand-back), fixed strings: the page labels a reply that is
// exactly one of them "Pilot:", and any other reply is the agent's ("Agent asked:").
export const APPROVE_ON_DESKTOP = 'Approve actions in Pilot on this Mac'
export const CARD_CHANGED = 'The card changed after you approved it; approve the version shown now.'
export const INTERRUPTED_AGAIN =
  'Pilot stopped while this action ran, so it may or may not have happened; check, then approve it again.'
export const CHANGED_AFTER_ANSWER = 'The card changed after you answered; answer this version.'
export const SENT_BEFORE_PILOT =
  'Sent to the session before Pilot took over. Tick it (pilot inbox tick) once the session is done.'
export const ANSWER_RUN_STOPPED =
  'The answer run was stopped before it finished; answer again to send it.'

const PILOT_REPLIES: ReadonlySet<string> = new Set([
  APPROVE_ON_DESKTOP,
  CARD_CHANGED,
  INTERRUPTED_AGAIN,
  CHANGED_AFTER_ANSWER,
  SENT_BEFORE_PILOT,
  ANSWER_RUN_STOPPED,
  START_RUN_ONLY
])

export function isPilotReply(text: string): boolean {
  return PILOT_REPLIES.has(text)
}
