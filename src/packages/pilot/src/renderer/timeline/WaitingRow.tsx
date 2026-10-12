import type { InboxItemSummary } from '../../shared/api-types'

const TYPE_LABEL: Record<string, string> = {
  question: 'Question',
  flagged: 'Flagged',
  default: 'Default taken',
  action: 'Action',
  bug: 'Bug',
  left_for_you: 'Left for you'
}

// An item a run asked. Answers are saved on the Inbox page (Task 26), not here.
export function WaitingRow({ item }: { item: InboxItemSummary }): React.JSX.Element {
  const open = item.status === 'open'
  const tone = open
    ? 'mt-1 rounded border border-amber-500/40 bg-amber-500/10 px-2 py-1 text-xs'
    : 'mt-1 px-2 text-xs text-muted-foreground'
  return (
    <div className={tone}>
      <span className="font-semibold">{open ? 'Inbox:' : 'Answered:'}</span>{' '}
      <span>{item.title}</span>{' '}
      <span className="text-muted-foreground">{`(${TYPE_LABEL[item.type] ?? item.type})`}</span>
    </div>
  )
}
