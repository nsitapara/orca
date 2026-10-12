import { Fragment } from 'react'

// Inline markdown: `code`, **bold**, *italic*, [label](url). Only an http(s) url becomes a link; any other keeps its label as plain text.
const INLINE = /`([^`]+)`|\*\*([^*]+)\*\*|\*([^*\s][^*]*)\*|\[([^\]]+)\]\(([^\s)]+)\)/g

export function SafeLink({
  href,
  children
}: {
  href: string
  children: React.ReactNode
}): React.JSX.Element {
  if (/^https?:\/\//i.test(href)) {
    return (
      <a href={href} target="_blank" rel="noopener noreferrer">
        {children}
      </a>
    )
  }
  return <span>{children}</span>
}

export function Inline({ text }: { text: string }): React.JSX.Element {
  const src = String(text ?? '')
  const out: React.ReactNode[] = []
  let last = 0
  for (const m of src.matchAll(INLINE)) {
    out.push(src.slice(last, m.index))
    out.push(<InlineMatch key={m.index} m={m} />)
    last = m.index + m[0].length
  }
  out.push(src.slice(last))
  return <>{out}</>
}

function InlineMatch({ m }: { m: RegExpMatchArray }): React.JSX.Element {
  if (m[1] != null) {
    return <code>{m[1]}</code>
  }
  if (m[2] != null) {
    return <strong>{m[2]}</strong>
  }
  if (m[3] != null) {
    return <em>{m[3]}</em>
  }
  return <SafeLink href={m[5]}>{m[4]}</SafeLink>
}

const BULLET = /^\s*[-*] /

type Chunk =
  | { kind: 'code'; text: string }
  | { kind: 'list'; items: string[] }
  | { kind: 'para'; lines: string[] }

function chunks(source: string): Chunk[] {
  const lines = String(source ?? '')
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/\s+$/, '')
    .split('\n')
  const out: Chunk[] = []
  for (let i = 0; i < lines.length;) {
    const line = lines[i]
    if (line.startsWith('```')) {
      const code: string[] = []
      for (i++; i < lines.length && !lines[i].startsWith('```'); i++) {
        code.push(lines[i])
      }
      i++
      out.push({ kind: 'code', text: code.join('\n') })
    } else if (BULLET.test(line)) {
      const items: string[] = []
      for (; i < lines.length && BULLET.test(lines[i]); i++) {
        items.push(lines[i].replace(BULLET, ''))
      }
      out.push({ kind: 'list', items })
    } else if (!line.trim()) {
      i++
    } else {
      const para: string[] = []
      for (
        ;
        i < lines.length &&
        lines[i].trim() &&
        !lines[i].startsWith('```') &&
        !BULLET.test(lines[i]);
        i++
      ) {
        para.push(lines[i])
      }
      out.push({ kind: 'para', lines: para })
    }
  }
  return out
}

function ChunkView({ chunk }: { chunk: Chunk }): React.JSX.Element {
  if (chunk.kind === 'code') {
    return (
      <pre>
        <code>{chunk.text}</code>
      </pre>
    )
  }
  if (chunk.kind === 'list') {
    return (
      <ul>
        {chunk.items.map((item, i) => (
          <li key={i}>
            <Inline text={item} />
          </li>
        ))}
      </ul>
    )
  }
  return (
    <p>
      {chunk.lines.map((line, i) => (
        <Fragment key={i}>
          {i > 0 ? <br /> : null}
          <Inline text={line} />
        </Fragment>
      ))}
    </p>
  )
}

// Paragraphs, bullet lists and fenced code. HTML comments (review-mr's idempotency marker) are hidden.
export function Markdown({ source }: { source: string }): React.JSX.Element {
  return (
    <>
      {chunks(source).map((chunk, i) => (
        <ChunkView key={i} chunk={chunk} />
      ))}
    </>
  )
}
