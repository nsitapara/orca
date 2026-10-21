import type { AnsweringCard } from '../../../shared/api-types-capacity'
import { usePilotHost } from '../../hosts/PilotHostContext'
import { showInboxCard } from '../automations-view'

// The cards an answer run is applying and what you answered on each; a title opens its card in the Inbox.
export function AnsweringCards({ cards }: { cards: readonly AnsweringCard[] }): React.JSX.Element {
  const host = usePilotHost()
  return (
    <ul aria-label="Answering" className="flex flex-col gap-1">
      {cards.map((card) => (
        <li
          key={card.id}
          className="flex min-w-0 flex-col rounded-r border-l-2 border-border bg-muted/50 px-2 py-1 text-xs"
        >
          <button
            type="button"
            title={card.title}
            className="min-w-0 truncate text-left text-foreground hover:underline"
            onClick={() => showInboxCard(card.id, host)}
          >
            {card.title}
          </button>
          {card.answer ? (
            <span className="min-w-0 truncate text-muted-foreground" title={card.answer}>
              You: {card.answer}
            </span>
          ) : null}
        </li>
      ))}
    </ul>
  )
}
