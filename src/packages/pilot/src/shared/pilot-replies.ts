// Pilot's own words under a card (a re-ask or a hand-back). Who wrote a reply is stored with it
// (InboxReply.by, set by the path that writes it), never inferred from these words.
export const APPROVE_ON_DESKTOP = 'Approve actions in Pilot on this Mac'
// apply.py DRAFT_PAGE_ONLY: a drafted patch (item-details) applies only on an approval given where its diff shows.
export const DRAFT_ON_DESKTOP =
  'A drafted change applies only on an approval saved in Pilot on this Mac, where its diff shows; approve it there.'
// The same rule on a question, whose drafted change is approved by picking the option the draft implements.
export const DRAFT_OPTION_ON_DESKTOP =
  "A drafted change applies only on a pick saved in Pilot on this Mac, where its diff shows; pick the drafted option in Pilot's window."
export const CARD_CHANGED = 'The card changed after you approved it; approve the version shown now.'
export const INTERRUPTED_AGAIN =
  'Pilot stopped while this action ran, so it may or may not have happened; check, then approve it again.'
export const CHANGED_AFTER_ANSWER = 'The card changed after you answered; answer this version.'
export const ANSWER_RUN_STOPPED =
  'The answer run was stopped before it finished; answer again to send it.'
