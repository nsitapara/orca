import { useState } from 'react'
import { Textarea } from '@/components/ui/textarea'
import { cn } from '@/lib/utils'
import type { InboxItemRow } from '../../../shared/api-types'
import { type AnswerButton, buttonsFor } from './answer-buttons'
import { type Choice, composeAnswer } from './answer-text'
import type { Answer } from './answer-types'

function notesPlaceholder(choice: Choice): string {
  if (choice.notes === 'optional') {
    return 'Anything the run should know (optional)'
  }
  return 'What should happen instead?'
}

function Parts({
  item,
  off,
  onToggle
}: {
  item: InboxItemRow
  off: string[]
  onToggle: (id: string) => void
}): React.JSX.Element {
  const onWord = item.switchWords[0] ?? 'Include'
  const offWord = item.switchWords[1] ?? 'Leave out'
  return (
    <ul className="flex flex-col gap-1 text-sm">
      {Object.entries(item.parts).map(([id, label]) => (
        <li key={id} className="flex items-center gap-2">
          <input
            type="checkbox"
            checked={!off.includes(id)}
            onChange={() => onToggle(id)}
            aria-label={`${onWord} ${id}`}
          />
          <span className="font-mono text-xs text-muted-foreground">{id}</span>
          <span>{label}</span>
          {off.includes(id) ? (
            <span className="rounded border px-1 text-xs text-muted-foreground">{offWord}</span>
          ) : null}
        </li>
      ))}
    </ul>
  )
}

const PRIMARY = 'bg-[var(--ib-accent)] text-[var(--ib-accent-fg)]'
const OUTLINE = 'border border-border bg-background text-foreground hover:bg-muted'

function buttonClass(b: AnswerButton): string {
  const filled = b.role === 'primary' || b.recommended
  return cn(
    'rounded-md px-3.5 py-1 text-[13px] font-semibold disabled:opacity-50',
    filled ? PRIMARY : OUTLINE
  )
}

// One button per choice, named for what it does; clicking one saves it (the card then shows its countdown with
// Undo). Only the choices that need words open the notes box, which has its own Send and Cancel.
export function AnswerRow({
  item,
  off,
  onToggle,
  onSave,
  onPick
}: {
  item: InboxItemRow
  off: string[]
  onToggle: (id: string) => void
  onSave: (answer: Answer) => Promise<string | null>
  // Whether words are being typed and not yet sent (the card's "unsaved" pill).
  onPick: (picked: boolean) => void
}): React.JSX.Element {
  const buttons = buttonsFor(item)
  const [open, setOpen] = useState<AnswerButton | null>(null)
  const [notes, setNotes] = useState('')
  const [saving, setSaving] = useState(false)
  const [hint, setHint] = useState('')
  const send = async (choice: Choice, words: string) => {
    const answer = composeAnswer(item, choice, words, off)
    if (!answer) {
      return
    }
    setSaving(true)
    await onSave(answer)
    setSaving(false)
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
  const ready = open ? composeAnswer(item, open.choice, notes, off) !== null : false
  return (
    <div className="flex flex-col gap-2 pt-1">
      {Object.keys(item.parts).length > 0 ? (
        <Parts item={item} off={off} onToggle={onToggle} />
      ) : null}
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
            title={skip.hint || undefined}
            disabled={saving}
            onClick={() => click(skip)}
            className="rounded px-1.5 py-1 text-[13px] text-muted-foreground hover:text-foreground disabled:opacity-50"
          >
            {skip.label}
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
