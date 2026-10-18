import { useRef } from 'react'
import { ShortcutKeyCombo } from '@/components/ShortcutKeyCombo'
import type { InboxListRow } from '../../../shared/api-types'
import { hostedKey, type Hosted } from '../../hosts/pilot-host'
import { useInboxFocusKeys } from './use-inbox-focus-keys'

type Card = Hosted<InboxListRow>

const UP_NEXT = 3

function clickAt(card: HTMLElement | null, selector: string, index: number): void {
  card?.querySelectorAll<HTMLElement>(selector)[index]?.click()
}

function KeyHint({ keys, label }: { keys: string[]; label: string }): React.JSX.Element {
  return (
    <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
      <ShortcutKeyCombo keys={keys} />
      {label}
    </span>
  )
}

export function InboxFocus({
  cards,
  at,
  onAt,
  renderCard,
  tabLabel,
  onExit
}: {
  cards: Card[]
  at: number
  onAt: (at: number) => void
  renderCard: (card: Card) => React.ReactNode
  tabLabel: string
  onExit: () => void
}): React.JSX.Element | null {
  const rootRef = useRef<HTMLDivElement>(null)
  const cardRef = useRef<HTMLDivElement>(null)
  // The list shrinks as cards are answered: clamp so the current card is always a real one.
  const current = Math.max(0, Math.min(at, cards.length - 1))
  const go = (next: number) => onAt(Math.max(0, Math.min(next, cards.length - 1)))
  useInboxFocusKeys(rootRef, {
    onNext: () => go(current + 1),
    onPrev: () => go(current - 1),
    onPick: (index) => clickAt(cardRef.current, '[data-choice]:not([data-skip])', index),
    onSkip: () => clickAt(cardRef.current, '[data-skip]', 0),
    onExit
  })
  const card = cards[current]
  if (!card) {
    return null
  }
  const upNext = cards.slice(current + 1, current + 1 + UP_NEXT)
  return (
    <div ref={rootRef} className="flex min-w-0 flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          disabled={current === 0}
          onClick={() => go(current - 1)}
          className="rounded-md border border-border px-2.5 py-1 text-xs text-muted-foreground hover:text-foreground disabled:opacity-50"
        >
          Previous
        </button>
        <span className="font-mono text-xs font-semibold text-muted-foreground">
          {current + 1} of {cards.length} in {tabLabel}
        </span>
        <button
          type="button"
          disabled={current >= cards.length - 1}
          onClick={() => go(current + 1)}
          className="rounded-md border border-border px-2.5 py-1 text-xs text-muted-foreground hover:text-foreground disabled:opacity-50"
        >
          Next
        </button>
        <span className="ml-auto flex flex-wrap items-center gap-3">
          <KeyHint keys={['J']} label="next" />
          <KeyHint keys={['K']} label="previous" />
          <KeyHint keys={['1-9']} label="answer" />
          <KeyHint keys={['S']} label="skip" />
          <KeyHint keys={['Esc']} label="back to cards" />
        </span>
      </div>
      <div ref={cardRef}>{renderCard(card)}</div>
      {upNext.length > 0 ? (
        <section aria-label="Up next" className="flex flex-col gap-1">
          <h2 className="font-mono text-xs font-semibold text-muted-foreground">Up next</h2>
          {upNext.map((c, i) => (
            <button
              key={hostedKey(c.host, c.id)}
              type="button"
              onClick={() => go(current + 1 + i)}
              className="truncate rounded px-1.5 py-1 text-left text-[13px] text-muted-foreground hover:text-foreground"
            >
              {c.title}
            </button>
          ))}
        </section>
      ) : null}
    </div>
  )
}
