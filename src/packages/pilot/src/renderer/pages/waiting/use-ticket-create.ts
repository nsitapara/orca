import { useState } from 'react'
import { toast } from 'sonner'
import { safeHref } from '../../../shared/safe-href'
import type { TicketCreateResult, TicketDraftEdit, TicketedRef } from '../../../shared/ticket-types'
import { hostRpc } from '../../hosts/host-rpc'
import type { PilotHostRef } from '../../hosts/pilot-host'
import { errorText } from '../format'

// Create uploads each ticked screenshot (25 s cap each) before it files the ticket.
const CREATE_TIMEOUT_MS = 180_000

export type TicketCreateArgs = { id: string; digest: string; draft: TicketDraftEdit }

async function fileTicket(host: PilotHostRef, args: TicketCreateArgs): Promise<TicketCreateResult> {
  try {
    return await hostRpc<TicketCreateResult>(host, 'pilot.inbox.ticketForLater', args, {
      timeoutMs: CREATE_TIMEOUT_MS
    })
  } catch (e) {
    // A call that failed in transit may still have reached Linear.
    return { ok: false, error: errorText(e), maybeCreated: true }
  }
}

function toastFiled(ref: TicketedRef): void {
  const href = safeHref(ref.url)
  const action = href
    ? { label: 'Open', onClick: () => window.open(href, '_blank', 'noopener,noreferrer') }
    : undefined
  toast.success(`Filed ${ref.identifier}`, { action })
}

// Create, and the frozen args: once Linear may hold the ticket, only those exact args go out again, for the
// panel's life, so Linear's write-id check returns that ticket instead of filing an edited second one. A draft
// the server froze earlier opens frozen.
export function useTicketCreate(
  host: PilotHostRef,
  onFiled: (ref: TicketedRef) => void,
  frozenAtOpen: TicketCreateArgs | null
) {
  const [creating, setCreating] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [frozen, setFrozen] = useState<TicketCreateArgs | null>(frozenAtOpen)
  const create = async (args: TicketCreateArgs): Promise<void> => {
    setCreating(true)
    setError(null)
    const result = await fileTicket(host, args)
    setCreating(false)
    if (result.ok) {
      const ref = { identifier: result.identifier, url: result.url }
      toastFiled(ref)
      onFiled(ref)
      return
    }
    setError(result.error)
    if (result.maybeCreated) {
      setFrozen((was) => was ?? args)
    }
  }
  return { creating, error, frozen, create }
}
