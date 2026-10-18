import { Fragment } from 'react'
import type {
  DiffRow,
  ReviewBlock as ReviewData,
  ReviewFile,
  ReviewPart
} from '../../shared/details'
import { DiffTable, FileHeader, Section } from './blocks'
import { Markdown, SafeLink } from './markdown'

// The row a finding is anchored to: its line on its side, as a context row or a change on that side.
function anchored(part: ReviewPart): (row: DiffRow) => boolean {
  const col = part.side === 'old' ? 0 : 1
  const sideKind = part.side === 'old' ? '-' : '+'
  return (row) => row[col] === part.line && (row[2] === ' ' || row[2] === sideKind)
}

function initials(name: string): string {
  return (name || '?')
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0].toUpperCase())
    .join('')
}

function where(part: ReviewPart): string {
  if (!part.in_diff) {
    return 'general comment'
  }
  return `${part.side === 'old' ? 'old' : 'new'} line ${part.line}`
}

function plural(n: number): string {
  return `${n} comment${n === 1 ? '' : 's'}`
}

function Thread({ part, review }: { part: ReviewPart; review: ReviewFile }): React.JSX.Element {
  return (
    <div className="glr-thread" data-part={part.id}>
      <div className="glr-note">
        <span className="glr-num">{part.id}</span>
        <span className="glr-avatar">{initials(review.reviewer.name)}</span>
        <div className="glr-body">
          <p className="glr-meta">
            <b>{review.reviewer.name}</b> @{review.reviewer.username} · {where(part)}
          </p>
          <Markdown source={part.comment} />
        </div>
      </div>
    </div>
  )
}

function FileGroup({
  title,
  count,
  list,
  review,
  withDiff
}: {
  title: string
  count: string
  list: ReviewPart[]
  review: ReviewFile
  withDiff: boolean
}): React.JSX.Element {
  return (
    <FileHeader title={title} count={count}>
      {list.map((part) => (
        <Fragment key={part.id}>
          {withDiff && part.context.length ? (
            <DiffTable rows={part.context} isAnchor={anchored(part)} />
          ) : null}
          <Thread part={part} review={review} />
        </Fragment>
      ))}
    </FileHeader>
  )
}

function parseReview(text: string | undefined): ReviewFile | null {
  try {
    const parsed = JSON.parse(text ?? '') as ReviewFile
    return Array.isArray(parsed.parts) && parsed.reviewer ? parsed : null
  } catch {
    return null
  }
}

function groupByFile(list: ReviewPart[]): [string, ReviewPart[]][] {
  const byFile = new Map<string, ReviewPart[]>()
  for (const part of list) {
    byFile.set(part.file, [...(byFile.get(part.file) ?? []), part])
  }
  return [...byFile]
}

// A review block, read only: the Details of job 09's old Post cards, stored before review blocks were retired.
export function ReviewBlock({
  block,
  texts
}: {
  block: ReviewData
  texts: Record<string, string>
}): React.JSX.Element {
  const review = parseReview(texts[block.file])
  if (!review) {
    return (
      <Section title={block.title} cls="dt-review">
        <div className="glr">
          <p className="glr-error">{`Couldn't load the review file ${block.file}`}</p>
        </div>
      </Section>
    )
  }
  const general = review.parts.filter((p) => !p.in_diff)
  return (
    <Section title={block.title} cls="dt-review">
      <div className="glr">
        <div className="glr-mr">
          <SafeLink href={review.web_url}>
            {review.project} · !{review.iid}
          </SafeLink>
          <p>
            {plural(review.parts.length)} on head {review.head_sha.slice(0, 8)}.
          </p>
        </div>
        {groupByFile(review.parts.filter((p) => p.in_diff)).map(([file, list]) => (
          <FileGroup
            key={file}
            title={file}
            count={plural(list.length)}
            list={list}
            review={review}
            withDiff
          />
        ))}
        {general.length ? (
          <FileGroup
            title="General comments"
            count="not on a changed line"
            list={general}
            review={review}
            withDiff={false}
          />
        ) : null}
      </div>
    </Section>
  )
}
