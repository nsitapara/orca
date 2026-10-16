import type { InboxListRow } from '../../../shared/api-types'
import type { AnswerState } from '../../../shared/inbox-types'
import { actionButton } from '../../../shared/answer-actions'
import { type Choice, choicesFor } from './answer-text'

// 'primary' is the card's Approve; 'option' a question's or default's own option; 'notes' opens the notes box
// (it has its own Send); 'skip' is the quiet one.
export type ButtonRole = 'primary' | 'option' | 'notes' | 'skip'
export type AnswerButton = {
  choice: Choice
  label: string
  // The option's description: the tooltip and the muted text beside the row.
  hint: string
  role: ButtonRole
  recommended: boolean
}

type Words = { label: string; doing: string }

function agentFix(item: InboxListRow): Words {
  if (item.details?.drafted) {
    return { label: 'Apply fix', doing: 'Applying fix…' }
  }
  return { label: 'Fix it', doing: 'Starting the fix…' }
}

// What Approve is called on this card, and what the card says while it runs.
export function approveWords(item: InboxListRow): Words {
  if (item.action === 'start_run') {
    return { label: 'Approve', doing: 'Starting…' }
  }
  if (item.action) {
    return actionButton(item.action)
  }
  if (item.type === 'left_for_you' || item.type === 'bug') {
    return agentFix(item)
  }
  return { label: 'Approve', doing: 'Applying…' }
}

function roleOf(choice: Choice): ButtonRole {
  if (choice.notes !== 'none') {
    return 'notes'
  }
  if (choice.label === 'Skip') {
    return 'skip'
  }
  return choice.label === 'Approve' ? 'primary' : 'option'
}

function labelOf(item: InboxListRow, choice: Choice, role: ButtonRole): string {
  if (role === 'primary') {
    return approveWords(item).label
  }
  return choice.label === 'Approve with notes…' ? 'With notes…' : choice.label
}

// One button per choice of the old radio list (choicesFor), so each saves exactly the answer that choice
// always saved: the same option index and words, through composeAnswer.
// A card nothing may run from yet: preparing, or (R-P5) a push, Post or drafted card that was never prepared.
function heldForEvidence(item: InboxListRow): boolean {
  if (item.needsEvidence) {
    return true
  }
  const state = item.preparation?.state
  return state !== undefined && state !== 'ready' && state !== 'cancelled'
}

type HeldWords = { answer: string; answerMeaning: string; answerHint: string; skip: string }

const PREPARING: HeldWords = {
  answer: 'Answer before context is ready…',
  answerMeaning: 'Stop context preparation and send your answer',
  answerHint: 'Stops preparation; does not approve an unseen change',
  skip: 'Skip this item and stop preparation'
}
// A never-prepared card has nothing preparing until Prepare evidence queues it, so no context is on its way.
const NEVER_PREPARED: HeldWords = {
  answer: 'Answer without evidence…',
  answerMeaning: 'Send your answer without prepared evidence',
  answerHint: 'Does not approve the change; use Prepare evidence for that',
  skip: 'Skip this item'
}

function heldButtons(item: InboxListRow): AnswerButton[] {
  const words = item.needsEvidence ? NEVER_PREPARED : PREPARING
  return [
    {
      choice: {
        label: 'Answer early',
        meaning: words.answerMeaning,
        notes: 'required',
        option: null,
        text: (notes) => notes.trim()
      },
      label: words.answer,
      hint: words.answerHint,
      role: 'notes',
      recommended: false
    },
    {
      choice: {
        label: 'Skip',
        meaning: words.skip,
        notes: 'none',
        option: null,
        text: () => 'skip'
      },
      label: 'Skip',
      hint: words.skip,
      role: 'skip',
      recommended: false
    }
  ]
}

export function buttonsFor(item: InboxListRow): AnswerButton[] {
  if (heldForEvidence(item)) {
    return heldButtons(item)
  }
  return choicesFor(item).map((choice) => {
    const role = roleOf(choice)
    return {
      choice,
      label: labelOf(item, choice, role),
      hint: choice.meaning,
      role,
      recommended: item.type === 'question' && role === 'option' && choice.option === 0
    }
  })
}

// What a saved answer will do, and the words for while it is being applied.
export function answeredLine(item: InboxListRow): Words {
  const text = (item.answer?.text ?? '').trim()
  const lower = text.toLowerCase()
  if (lower === 'skip') {
    return { label: 'Skipped', doing: 'Skipped' }
  }
  if (lower === 'approve') {
    const w = approveWords(item)
    return { label: w.label, doing: w.doing }
  }
  if (lower.startsWith('revise:')) {
    return { label: 'Revise', doing: 'Revising…' }
  }
  return { label: text || 'Answered', doing: 'Applying…' }
}

// "2:59": the time left, rounded up to the second, never below zero.
export function countdown(ms: number): string {
  const seconds = Math.max(0, Math.ceil(ms / 1000))
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`
}

// Where a saved answer stands, from the server's answer state. Settling and held can be undone; applying
// (locked: it may be being carried out) cannot; failed and sent-before-Pilot offer Change answer; waiting is an unlocked answer
// nothing has picked up yet (past its settle time, or no row), which can still be undone.
export type Phase = 'settling' | 'held' | 'applying' | 'failed' | 'sent' | 'waiting'

export function phaseOf(state: AnswerState | null, now: number): Phase {
  if (state?.locked) {
    return 'applying'
  }
  if (state?.state === 'failed') {
    return 'failed'
  }
  if (state?.sentBeforePilot) {
    return 'sent'
  }
  if (state?.state === 'held') {
    return 'held'
  }
  if (state?.state === 'not_ready' && state.readyAt !== null && state.readyAt > now) {
    return 'settling'
  }
  return 'waiting'
}
