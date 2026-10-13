import { ChevronRight } from 'lucide-react'
import { Fragment, useState } from 'react'
import { cn } from '@/lib/utils'
import type { DiffBlock as DiffBlockData, DiffFile } from '../../shared/details'
import { DiffTable, Gap, Section } from './blocks'

const BIG_ROWS = 300
const SHORT_PATH = 56
const GENERATED = [
  /(^|\/)generated\//,
  /(^|\/)queries\.json$/,
  /\.generated\./,
  /\.lock$/,
  /(^|\/)pnpm-lock\.yaml$/,
  /(^|\/)package-lock\.json$/
]

const isGenerated = (path: string): boolean => GENERATED.some((re) => re.test(path))
const rowsOf = (file: DiffFile): number => (file.hunks ?? []).reduce((n, h) => n + h.length, 0)

function tagOf(file: DiffFile): string {
  if (isGenerated(file.path)) {
    return 'generated'
  }
  return !file.old_path && (file.removed ?? 0) === 0 ? 'new file' : ''
}

// Generated files and big ones start folded; the rest open.
function startsOpen(file: DiffFile): boolean {
  return !isGenerated(file.path) && rowsOf(file) <= BIG_ROWS
}

// A long path keeps its tail: "…/dir/file.ts".
export function shortPath(path: string): string {
  if (path.length <= SHORT_PATH) {
    return path
  }
  const parts = path.split('/')
  let tail = parts.pop() ?? path
  while (parts.length > 0 && `…/${parts.at(-1)}/${tail}`.length <= SHORT_PATH) {
    tail = `${parts.pop()}/${tail}`
  }
  return `…/${tail}`
}

// What a capped diff (details.py) left out: a drafted one still has it in its patch; any other is on the MR.
function omittedText(file: DiffFile, inPatch: boolean): string {
  if (inPatch) {
    return `${file.path}: diff too large to show here (in the patch)`
  }
  return `${file.path}: diff not shown here, too large; see the MR`
}

function moreFilesText(count: number, inPatch: boolean): string {
  if (inPatch) {
    return `${count} more files not shown (in the patch)`
  }
  return `${count} more files not shown here; see the MR`
}

function FileView({
  file,
  open,
  inPatch,
  onToggle
}: {
  file: DiffFile
  open: boolean
  inPatch: boolean
  onToggle: () => void
}): React.JSX.Element {
  const renamed = file.old_path && file.old_path !== file.path
  const title = renamed ? `${file.old_path} → ${file.path}` : file.path
  const tag = tagOf(file)
  return (
    <section className="glr-file">
      <button
        type="button"
        aria-expanded={open}
        onClick={onToggle}
        className="glr-file-h w-full items-center border-0 text-left"
      >
        <ChevronRight
          aria-hidden
          className={cn('size-3 shrink-0 transition-transform', open && 'rotate-90')}
        />
        <span className="glr-path min-w-0 flex-1 truncate" title={title}>
          {shortPath(renamed ? title : file.path)}
        </span>
        {tag ? <span className="text-xs text-[var(--g-sub)]">{tag}</span> : null}
        <span className="glr-count">{`+${file.added ?? 0} −${file.removed ?? 0}`}</span>
      </button>
      {open ? (
        <>
          {(file.hunks ?? []).map((hunk, n) => (
            <Fragment key={n}>
              {n ? <Gap /> : null}
              <DiffTable rows={hunk} />
            </Fragment>
          ))}
          {file.omitted ? (
            <p className="dt-missing glr-omitted">{omittedText(file, inPatch)}</p>
          ) : null}
        </>
      ) : null}
    </section>
  )
}

function Checks({ checks }: { checks: string[] }): React.JSX.Element {
  const [open, setOpen] = useState(false)
  const failed = checks.filter((c) => /\bfail/i.test(c)).length
  const noun = checks.length === 1 ? 'check' : 'checks'
  const label =
    failed > 0 ? `${checks.length} ${noun} · ${failed} failed` : `${checks.length} ${noun} passed`
  return (
    <div className="grid gap-1">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
        className={cn(
          'w-fit text-left text-[12.5px] font-semibold hover:underline',
          failed > 0 ? 'text-[var(--ib-bad)]' : 'text-[var(--ib-ok)]'
        )}
      >
        {label}
      </button>
      {open ? (
        <ul className="dt-checks">
          {checks.map((check, i) => (
            <li key={i}>{check}</li>
          ))}
        </ul>
      ) : null}
    </div>
  )
}

export function DiffBlock({ block }: { block: DiffBlockData }): React.JSX.Element {
  const files = block.files ?? []
  const [open, setOpen] = useState<boolean[]>(() => files.map(startsOpen))
  const anyClosed = open.some((o) => !o)
  const inPatch = Boolean(block.patch)
  const set = (i: number, value: boolean) =>
    setOpen((now) => now.map((o, n) => (n === i ? value : o)))
  return (
    <Section title={block.title} cls="dt-diff">
      {files.length > 1 ? (
        <button
          type="button"
          onClick={() => setOpen(files.map(() => anyClosed))}
          className="w-fit text-xs text-[var(--ib-accent)] hover:underline"
        >
          {anyClosed ? 'Expand all files' : 'Collapse all files'}
        </button>
      ) : null}
      {files.map((file, i) => (
        <FileView
          key={i}
          file={file}
          open={open[i] ?? true}
          inPatch={inPatch}
          onToggle={() => set(i, !open[i])}
        />
      ))}
      {block.more_files ? (
        <p className="dt-missing">{moreFilesText(block.more_files, inPatch)}</p>
      ) : null}
      {(block.checks ?? []).length ? <Checks checks={block.checks ?? []} /> : null}
    </Section>
  )
}
