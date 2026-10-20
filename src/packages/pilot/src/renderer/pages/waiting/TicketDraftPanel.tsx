import { useEffect, useId, useState } from 'react'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import type { InboxListRow } from '../../../shared/api-types'
import { safeHref } from '../../../shared/safe-href'
import { FROZEN_DRAFT } from '../../../shared/ticket-outcome'
import {
  TICKET_PRIORITIES,
  type TicketDraft,
  type TicketedRef,
  type TicketImage
} from '../../../shared/ticket-types'
import { useImageUrl } from '../../details/use-image'
import { hostRpc } from '../../hosts/host-rpc'
import { hostOf, type Hosted, type PilotHostRef } from '../../hosts/pilot-host'
import { errorText } from '../format'
import { OUTLINE_BUTTON, PRIMARY_BUTTON } from './card-button-classes'
import { loadCardImage } from './CardDetails'
import { Select } from './InboxHeader'
import {
  assigneeLine,
  canCreate,
  createSummary,
  editOf,
  fieldsOf,
  PRIORITY_WORDS,
  TITLE_MAX,
  type DraftFields
} from './ticket-draft-fields'
import { TicketedBeforeChip } from './TicketedBeforeChip'
import { useTicketCreate } from './use-ticket-create'

const SCREENSHOT_NOTE =
  'Ticked screenshots upload to Linear. Untick any that show real patient data.'
// Fixed width for "Create INFRA ticket", so swapping to Creating… or Retry doesn't move the row.
const CREATE_BUTTON = `${PRIMARY_BUTTON} w-44 truncate`

type Load = { draft: TicketDraft } | { error: string }

function Frame({
  chip,
  children
}: {
  chip?: React.ReactNode
  children: React.ReactNode
}): React.JSX.Element {
  return (
    <section
      aria-label="Ticket for later"
      className="flex min-w-0 flex-col gap-3 border-t border-border pt-3"
    >
      <div className="flex flex-wrap items-center gap-2">
        <h4 className="text-[13px] font-semibold">Ticket for later</h4>
        {chip}
      </div>
      {children}
    </section>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="flex min-w-0 flex-col gap-1">
      <span className="text-xs text-muted-foreground">{label}</span>
      {children}
    </label>
  )
}

function BackRow({ onClose }: { onClose: () => void }): React.JSX.Element {
  return (
    <div className="flex justify-end">
      <button type="button" onClick={onClose} className={OUTLINE_BUTTON}>
        Back
      </button>
    </div>
  )
}

function Thumb({
  host,
  item,
  file
}: {
  host: PilotHostRef
  item: InboxListRow
  file: string
}): React.JSX.Element {
  const { url, failed } = useImageUrl(() => loadCardImage(host, item, file))
  if (!url) {
    return (
      <span className="flex h-12 w-20 shrink-0 items-center justify-center rounded border border-border bg-muted text-3xs text-muted-foreground">
        {failed ? 'No preview' : null}
      </span>
    )
  }
  return (
    <img
      src={url}
      alt=""
      className="h-12 w-20 shrink-0 rounded border border-border bg-muted object-contain"
    />
  )
}

function Screenshot({
  host,
  item,
  image,
  ticked,
  locked,
  onTick
}: {
  host: PilotHostRef
  item: InboxListRow
  image: TicketImage
  ticked: boolean
  locked: boolean
  onTick: (ticked: boolean) => void
}): React.JSX.Element {
  const id = useId()
  const name = image.caption ? `${image.caption} · ${image.ref}` : image.ref
  // The thumbnail is outside the label, so clicking it never ticks a screenshot back on.
  return (
    <div className="flex min-w-0 items-center gap-2 text-[13px]">
      <Checkbox
        id={id}
        aria-label={name}
        checked={ticked}
        disabled={locked}
        onCheckedChange={(next) => onTick(next === true)}
      />
      <Thumb host={host} item={item} file={image.file} />
      <label htmlFor={id} className="min-w-0 flex-1 truncate">
        {image.caption}
      </label>
      <code className="font-mono text-xs text-muted-foreground">{image.ref}</code>
    </div>
  )
}

function LinkLine({ link }: { link: { url: string; title: string } }): React.JSX.Element {
  const href = safeHref(link.url)
  const text = link.title || link.url
  return (
    <p className="text-xs text-muted-foreground">
      MR link ·{' '}
      {href ? (
        <a
          href={href}
          target="_blank"
          rel="noopener noreferrer"
          className="text-foreground underline-offset-2 hover:underline"
        >
          {text}
        </a>
      ) : (
        <span>{text}</span>
      )}
    </p>
  )
}

function createLabel(creating: boolean, frozen: boolean, team: string): string {
  if (creating) {
    return 'Creating…'
  }
  if (frozen) {
    return 'Retry'
  }
  return team ? `Create ${team} ticket` : 'Create ticket'
}

function DraftForm({
  item,
  host,
  draft,
  onClose,
  onFiled
}: {
  item: InboxListRow
  host: PilotHostRef
  draft: TicketDraft
  onClose: () => void
  onFiled: (ref: TicketedRef) => void
}): React.JSX.Element {
  const [fields, setFields] = useState<DraftFields>(() => fieldsOf(draft))
  const { creating, error, frozen, create } = useTicketCreate(
    host,
    onFiled,
    draft.frozen ? { id: item.id, digest: draft.digest, draft: draft.frozen } : null
  )
  const locked = creating || frozen !== null
  const set = (patch: Partial<DraftFields>) => setFields((now) => ({ ...now, ...patch }))
  const tick = (ref: string, on: boolean) =>
    setFields((now) => ({
      ...now,
      unticked: on ? now.unticked.filter((r) => r !== ref) : [...now.unticked, ref]
    }))
  const edit = editOf(fields, draft)
  const titleTooLong = edit.title.length > TITLE_MAX
  const submit = () => void create(frozen ?? { id: item.id, digest: draft.digest, draft: edit })
  return (
    <Frame
      chip={draft.ticketedBefore ? <TicketedBeforeChip ticket={draft.ticketedBefore} /> : null}
    >
      <Field label="Title">
        <Input
          value={fields.title}
          disabled={locked}
          aria-invalid={titleTooLong}
          onChange={(e) => set({ title: e.target.value })}
        />
      </Field>
      {titleTooLong ? (
        <p aria-live="polite" className="text-xs text-destructive">
          The title is over 255 characters; shorten it.
        </p>
      ) : null}
      <div className="grid grid-cols-3 gap-2">
        <Field label="Team">
          <Input
            value={fields.team}
            disabled={locked}
            onChange={(e) => set({ team: e.target.value })}
          />
        </Field>
        <Field label="State">
          <Input
            value={fields.state}
            disabled={locked}
            onChange={(e) => set({ state: e.target.value })}
          />
        </Field>
        <Field label="Labels">
          <Input
            value={fields.labels}
            placeholder="Comma-separated"
            disabled={locked}
            onChange={(e) => set({ labels: e.target.value })}
          />
        </Field>
      </div>
      <div className="flex flex-wrap items-center gap-3 text-[13px]">
        <Select
          label="Priority"
          prefix="Priority"
          value={fields.priority}
          disabled={locked}
          onChange={(value) => {
            const priority = TICKET_PRIORITIES.find((p) => p === value)
            if (priority) {
              set({ priority })
            }
          }}
        >
          {TICKET_PRIORITIES.map((p) => (
            <option key={p} value={p}>
              {PRIORITY_WORDS[p]}
            </option>
          ))}
        </Select>
        <span className="text-muted-foreground">{assigneeLine(draft.assignee)}</span>
      </div>
      <Field label="Description">
        <Textarea
          variant="code"
          rows={12}
          value={fields.body}
          disabled={locked}
          onChange={(e) => set({ body: e.target.value })}
        />
      </Field>
      {draft.images.length > 0 ? (
        <div className="flex flex-col gap-1.5">
          <p className="text-xs text-muted-foreground">
            Lines naming an unticked screenshot stay here; Create drops them.
          </p>
          {draft.images.map((image) => (
            <Screenshot
              key={image.ref}
              host={host}
              item={item}
              image={image}
              ticked={!fields.unticked.includes(image.ref)}
              locked={locked}
              onTick={(on) => tick(image.ref, on)}
            />
          ))}
          <p className="text-xs text-muted-foreground">{SCREENSHOT_NOTE}</p>
        </div>
      ) : null}
      {draft.link ? <LinkLine link={draft.link} /> : null}
      <p className="text-xs text-muted-foreground">{createSummary(edit, draft)}</p>
      {error && error !== FROZEN_DRAFT ? (
        <p aria-live="polite" className="text-sm text-destructive">
          {error}
        </p>
      ) : null}
      {frozen ? <p className="text-sm">{FROZEN_DRAFT}</p> : null}
      <div className="flex justify-end gap-2">
        <button type="button" disabled={creating} onClick={onClose} className={OUTLINE_BUTTON}>
          Back
        </button>
        <button
          type="button"
          disabled={creating || (frozen === null && !canCreate(edit))}
          onClick={submit}
          className={CREATE_BUTTON}
        >
          {createLabel(creating, frozen !== null, edit.team)}
        </button>
      </div>
    </Frame>
  )
}

// Ticket for later's draft, in place of the answer row: built on the card's machine, edited here, and filed
// only on Create. A new card version remounts the card, which drops the draft built from the old one.
export function TicketDraftPanel({
  item,
  onClose,
  onFiled
}: {
  item: Hosted<InboxListRow>
  onClose(): void
  onFiled(ref: TicketedRef): void
}): React.JSX.Element {
  // Pinned at open, so a refreshed host entry doesn't fetch the draft again.
  const [host] = useState(() => hostOf(item))
  const { id, digest } = item
  const [load, setLoad] = useState<Load | null>(null)
  const [attempt, setAttempt] = useState(0)
  useEffect(() => {
    let live = true
    hostRpc<TicketDraft>(host, 'pilot.inbox.ticketDraft', { id, digest }).then(
      (draft) => {
        if (live) {
          setLoad({ draft })
        }
      },
      (e: unknown) => {
        if (live) {
          setLoad({ error: errorText(e) })
        }
      }
    )
    return () => {
      live = false
    }
  }, [host, id, digest, attempt])
  if (load && 'draft' in load) {
    return (
      <DraftForm item={item} host={host} draft={load.draft} onClose={onClose} onFiled={onFiled} />
    )
  }
  const retry = () => {
    setLoad(null)
    setAttempt((n) => n + 1)
  }
  return (
    <Frame>
      {load ? (
        <p aria-live="polite" className="text-sm text-destructive">
          Couldn&apos;t draft the ticket: {load.error}{' '}
          <button type="button" className="underline underline-offset-4" onClick={retry}>
            Retry
          </button>
        </p>
      ) : (
        <p className="text-sm text-muted-foreground">Loading the draft…</p>
      )}
      <BackRow onClose={onClose} />
    </Frame>
  )
}
