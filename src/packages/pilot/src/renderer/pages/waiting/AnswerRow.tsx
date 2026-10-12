import { useRef, useState } from 'react'
import { Textarea } from '@/components/ui/textarea'
import { cn } from '@/lib/utils'
import type { InboxItemRow } from '../../../shared/api-types'
import { type Choice, choicesFor, composeAnswer } from './answer-text'
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

// The options as segmented buttons: one radiogroup, arrow keys move the pick, and the picked option's
// meaning reads beside them.
export function AnswerRow({
  item,
  off,
  onToggle,
  onSave,
  onSaved,
  onPick
}: {
  item: InboxItemRow
  off: string[]
  onToggle: (id: string) => void
  onSave: (answer: Answer) => Promise<string | null>
  onSaved: () => void
  onPick: (picked: boolean) => void
}): React.JSX.Element {
  const choices = choicesFor(item)
  const [picked, setPicked] = useState<number | null>(null)
  const [notes, setNotes] = useState('')
  const [saving, setSaving] = useState(false)
  const radios = useRef<(HTMLButtonElement | null)[]>([])
  const choice = picked === null ? null : choices[picked]
  const answer = choice ? composeAnswer(item, choice, notes, off) : null
  const pick = (i: number) => {
    setPicked(i)
    onPick(true)
  }
  const move = (from: number, step: number) => {
    const next = (from + step + choices.length) % choices.length
    pick(next)
    radios.current[next]?.focus()
  }
  const onKey = (e: React.KeyboardEvent, i: number) => {
    if (e.key === 'ArrowRight' || e.key === 'ArrowDown') {
      e.preventDefault()
      move(i, 1)
    } else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') {
      e.preventDefault()
      move(i, -1)
    }
  }
  const save = async () => {
    if (!answer) {
      return
    }
    setSaving(true)
    const failed = await onSave(answer)
    setSaving(false)
    if (!failed) {
      onSaved()
    }
  }
  return (
    <div className="flex flex-col gap-2 pt-1">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <div
          role="radiogroup"
          aria-label="Answer"
          className="inline-flex flex-wrap overflow-hidden rounded-md border border-border"
        >
          {choices.map((c, i) => (
            <button
              key={c.label}
              ref={(el) => {
                radios.current[i] = el
              }}
              type="button"
              role="radio"
              aria-checked={picked === i}
              data-value={c.label}
              tabIndex={picked === i || (picked === null && i === 0) ? 0 : -1}
              onClick={() => pick(i)}
              onKeyDown={(e) => onKey(e, i)}
              className={cn(
                'border-l border-border px-3 py-1 text-[13px] first:border-l-0',
                picked === i
                  ? 'bg-primary/15 font-semibold text-primary'
                  : 'bg-background text-foreground hover:bg-muted'
              )}
            >
              {c.label}
            </button>
          ))}
        </div>
        {choice?.meaning ? (
          <span className="min-w-0 flex-1 text-[13px] text-muted-foreground">{choice.meaning}</span>
        ) : (
          <span className="flex-1" />
        )}
        <button
          type="button"
          data-save=""
          disabled={!answer || saving}
          onClick={() => void save()}
          className={cn(
            'rounded-md px-3.5 py-1 text-[13px] font-semibold',
            answer && !saving
              ? 'bg-primary text-primary-foreground'
              : 'cursor-not-allowed bg-muted text-muted-foreground'
          )}
        >
          Save answer
        </button>
      </div>
      {choice && choice.notes !== 'none' ? (
        <Textarea
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          placeholder={notesPlaceholder(choice)}
        />
      ) : null}
      {Object.keys(item.parts).length > 0 && choice?.label === 'Approve' ? (
        <Parts item={item} off={off} onToggle={onToggle} />
      ) : null}
    </div>
  )
}
