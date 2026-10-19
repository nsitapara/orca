import { useState } from 'react'
import { Textarea } from '@/components/ui/textarea'
import { isWebClientLocation } from '@/lib/web-client-location'
import { cn } from '@/lib/utils'
import type { InboxListRow } from '../../../shared/api-types'
import { hostOf, type Hosted } from '../../hosts/pilot-host'
import { type AnswerButton, buttonsFor } from './answer-buttons'
import { type Choice, composeAnswer } from './answer-text'
import type { Answer } from './answer-types'
import { OUTLINE, PRIMARY, QUIET_BUTTON } from './card-button-classes'
import { canTicketForLater } from './ticket-button'
import { TicketDraftPanel } from './TicketDraftPanel'

function notesPlaceholder(choice: Choice): string {
  if (choice.notes === 'optional') {
    return 'Anything the run should know (optional)'
  }
  return 'What should happen instead?'
}

function buttonClass(b: AnswerButton): string {
  const filled = b.role === 'primary' || b.recommended
  return cn(
    'rounded-md px-3.5 py-1 text-[13px] font-semibold disabled:opacity-50',
    filled ? PRIMARY : OUTLINE
  )
}

// One button per choice, named for what it does; clicking one saves it (the card then shows its countdown with
// Undo). Only the choices that need words open the notes box, which has its own Send and Cancel.
// Ticket for later is its own button, never a choice: its draft replaces the row until Back or Create.
export function AnswerRow({
  item,
  onSave,
  onPick,
  onTicketed
}: {
  item: Hosted<InboxListRow>
  onSave: (answer: Answer) => Promise<string | null>
  // Whether words are being typed and not yet sent (the card's "unsaved" pill).
  onPick: (picked: boolean) => void
  onTicketed: () => void
}): React.JSX.Element {
  const buttons = buttonsFor(item)
  const [open, setOpen] = useState<AnswerButton | null>(null)
  const [notes, setNotes] = useState('')
  const [saving, setSaving] = useState(false)
  const [hint, setHint] = useState('')
  const [ticketing, setTicketing] = useState(false)
  const send = async (choice: Choice, words: string) => {
    const answer = composeAnswer(choice, words)
    if (!answer) {
      return
    }
    setSaving(true)
    const failed = await onSave(answer)
    setSaving(false)
    if (!failed) {
      // Sent: the words are no longer waiting to be sent (the card's "unsaved" pill).
      setOpen(null)
      setNotes('')
      onPick(false)
    }
  }
  const click = (b: AnswerButton) => {
    if (b.choice.notes === 'none') {
      void send(b.choice, '')
      return
    }
    setOpen(b)
    onPick(true)
  }
  const close = () => {
    setOpen(null)
    setNotes('')
    onPick(false)
  }
  const skip = buttons.find((b) => b.role === 'skip')
  const rest = buttons.filter((b) => b.role !== 'skip')
  const ready = open ? composeAnswer(open.choice, notes) !== null : false
  if (ticketing) {
    return (
      <TicketDraftPanel
        item={item}
        onClose={() => setTicketing(false)}
        onFiled={() => {
          setTicketing(false)
          onTicketed()
        }}
      />
    )
  }
  return (
    <div className="flex flex-col gap-2 pt-1">
      {open ? (
        <div className="flex flex-col gap-2">
          <Textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder={notesPlaceholder(open.choice)}
          />
          <div className="flex justify-end gap-2">
            <button
              type="button"
              className={`${OUTLINE} rounded-md px-3 py-1 text-[13px]`}
              onClick={close}
            >
              Cancel
            </button>
            <button
              type="button"
              disabled={!ready || saving}
              onClick={() => void send(open.choice, notes)}
              className={cn(
                'rounded-md px-3.5 py-1 text-[13px] font-semibold disabled:opacity-50',
                PRIMARY
              )}
            >
              Send
            </button>
          </div>
        </div>
      ) : null}
      <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Answer">
        {skip ? (
          <button
            type="button"
            data-choice={skip.choice.label}
            data-skip=""
            title={skip.hint || undefined}
            disabled={saving}
            onClick={() => click(skip)}
            className={QUIET_BUTTON}
          >
            {skip.label}
          </button>
        ) : null}
        {canTicketForLater(item, hostOf(item), isWebClientLocation()) ? (
          <button
            type="button"
            disabled={saving}
            onClick={() => setTicketing(true)}
            className={QUIET_BUTTON}
          >
            Ticket for later
          </button>
        ) : null}
        <span className="min-w-0 flex-1 text-[13px] text-muted-foreground">{hint}</span>
        {rest.map((b) => (
          <button
            key={b.choice.label}
            type="button"
            data-choice={b.choice.label}
            title={b.hint || undefined}
            disabled={saving}
            onClick={() => click(b)}
            onMouseEnter={() => setHint(b.hint)}
            onMouseLeave={() => setHint('')}
            onFocus={() => setHint(b.hint)}
            onBlur={() => setHint('')}
            className={buttonClass(b)}
          >
            {b.label}
          </button>
        ))}
      </div>
    </div>
  )
}
