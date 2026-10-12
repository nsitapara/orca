import { Fragment } from 'react'
import type {
  CodeBlock as CodeBlockData,
  DiffBlock as DiffBlockData,
  DiffRow,
  FactsBlock as FactsBlockData,
  MissingBlock as MissingBlockData,
  TextBlock as TextBlockData,
  ThreadBlock as ThreadBlockData
} from '../../shared/details'
import { Inline, Markdown, SafeLink } from './markdown'

const ROW_CLASS: Record<string, string> = { '+': 'add', '-': 'del' }

function Scroll({ children }: { children: React.ReactNode }): React.JSX.Element {
  return <div className="glr-scroll">{children}</div>
}

function cell(no: number | null | undefined): string {
  return no == null ? '' : String(no)
}

function rowClass(row: DiffRow, anchored: boolean): string {
  const base = ROW_CLASS[row[2]] ?? ''
  return anchored ? `${base} anchor`.trim() : base
}

// Rows of [old line or null, new line or null, ' '|'+'|'-', text]. isAnchor marks the row a finding points at.
export function DiffTable({
  rows,
  isAnchor
}: {
  rows: DiffRow[]
  isAnchor?: (row: DiffRow) => boolean
}): React.JSX.Element {
  return (
    <Scroll>
      <table className="glr-diff">
        <tbody>
          {rows.map((row, i) => (
            <tr key={i} className={rowClass(row, isAnchor ? isAnchor(row) : false)}>
              <td className="ln">{cell(row[0])}</td>
              <td className="ln">{cell(row[1])}</td>
              <td className="code">{row[3]}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </Scroll>
  )
}

function Gap(): React.JSX.Element {
  return (
    <Scroll>
      <table className="glr-diff">
        <tbody>
          <tr className="gap">
            <td>⋯</td>
          </tr>
        </tbody>
      </table>
    </Scroll>
  )
}

export function FileHeader({
  title,
  count,
  children
}: {
  title: string
  count?: string
  children?: React.ReactNode
}): React.JSX.Element {
  return (
    <section className="glr-file">
      <div className="glr-file-h">
        <span className="glr-path">{title}</span>
        <span className="glr-count">{count ?? ''}</span>
      </div>
      {children}
    </section>
  )
}

export function Section({
  title,
  cls,
  children
}: {
  title?: string | null
  cls: string
  children: React.ReactNode
}): React.JSX.Element {
  return (
    <section className={`dt-section ${cls}`}>
      {title ? <h4 className="dt-title">{title}</h4> : null}
      {children}
    </section>
  )
}

export function FactsBlock({ block }: { block: FactsBlockData }): React.JSX.Element {
  return (
    <Section title={block.title} cls="dt-facts-box">
      <dl className="dt-facts">
        {(block.rows ?? []).map(([label, value], i) => (
          <Fragment key={i}>
            <dt>{label}</dt>
            <dd>
              <Inline text={value} />
            </dd>
          </Fragment>
        ))}
      </dl>
    </Section>
  )
}

export function DiffBlock({ block }: { block: DiffBlockData }): React.JSX.Element {
  return (
    <Section title={block.title} cls="dt-diff">
      {(block.files ?? []).map((file, i) => {
        const renamed = file.old_path && file.old_path !== file.path
        const title = renamed ? `${file.old_path} → ${file.path}` : file.path
        return (
          <FileHeader key={i} title={title} count={`+${file.added ?? 0} −${file.removed ?? 0}`}>
            {(file.hunks ?? []).map((hunk, n) => (
              <Fragment key={n}>
                {n ? <Gap /> : null}
                <DiffTable rows={hunk} />
              </Fragment>
            ))}
            {file.omitted ? (
              <p className="dt-missing glr-omitted">
                {file.path}: diff not shown here, too large; see the MR
              </p>
            ) : null}
          </FileHeader>
        )
      })}
      {block.more_files ? (
        <p className="dt-missing">{block.more_files} more files not shown here; see the MR</p>
      ) : null}
      {(block.checks ?? []).length ? (
        <ul className="dt-checks">
          {(block.checks ?? []).map((check, i) => (
            <li key={i}>{check}</li>
          ))}
        </ul>
      ) : null}
    </Section>
  )
}

export function CodeBlock({ block }: { block: CodeBlockData }): React.JSX.Element {
  const title = `${block.path} @ ${String(block.sha ?? '').slice(0, 8)}`
  return (
    <Section title={block.title} cls="dt-code">
      <FileHeader title={title} count={block.anchor ? `line ${block.anchor}` : ''}>
        <Scroll>
          <table className="glr-diff">
            <tbody>
              {(block.rows ?? []).map(([line, text], i) => (
                <tr key={i} className={line === block.anchor ? 'anchor' : ''}>
                  <td className="ln">{line}</td>
                  <td className="code">{text}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Scroll>
      </FileHeader>
    </Section>
  )
}

export function ThreadBlock({ block }: { block: ThreadBlockData }): React.JSX.Element {
  return (
    <Section title={block.title} cls="dt-thread">
      {(block.notes ?? []).map((note, i) => (
        <div key={i} className="dt-note glr-body">
          <p className="dt-meta">
            <b>{note.author || 'someone'}</b>
            {note.at ? ` · ${note.at}` : ''}
          </p>
          <Markdown source={note.body ?? ''} />
        </div>
      ))}
      {block.url ? <SafeLink href={block.url}>Open the thread ↗</SafeLink> : null}
    </Section>
  )
}

export function TextBlock({ block }: { block: TextBlockData }): React.JSX.Element {
  return (
    <Section title={block.title} cls="dt-text">
      <div className="glr-body">
        <Markdown source={block.body} />
      </div>
    </Section>
  )
}

export function MissingBlock({ block }: { block: MissingBlockData }): React.JSX.Element {
  return (
    <p className="dt-missing">
      {block.what}: {block.why}
    </p>
  )
}
