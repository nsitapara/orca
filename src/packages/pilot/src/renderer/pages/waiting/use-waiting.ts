import { useCallback, useLayoutEffect, useRef, useState } from 'react'
import type { InboxListRow } from '../../../shared/api-types'
import type {
  DispatchReport,
  InboxListPayload,
  QueueListPayload
} from '../../../shared/inbox-types'
import { pilotRpc } from '../../api'
import { useHeldMerge } from '../../hosts/held-merge'
import { useHostPoll, type HostRead } from '../../hosts/host-poll'
import { mergedError, mergeInbox, mergeQueue } from '../../hosts/merge-inbox'
import { errorText } from '../format'
import { applyReport } from './answer-text'

const REFRESH_MS = 10_000
// Apply now may run actions (act.py allows 10 min) before it answers.
const APPLY_TIMEOUT_MS = 660_000

// When a machine last brought a new list: card ages are measured from it, so a render never reads the clock.
function useLoadedAt(reads: readonly HostRead<unknown>[]): number {
  const [loadedAt, setLoadedAt] = useState(0)
  const seen = useRef<ReadonlySet<unknown>>(new Set())
  // Before paint, so a new list never shows with the old clock.
  useLayoutEffect(() => {
    const values = reads.map((r) => r.value)
    const fresh = values.some((v) => v !== null && !seen.current.has(v))
    seen.current = new Set(values)
    if (fresh) {
      setLoadedAt(Date.now())
    }
  }, [reads])
  return loadedAt
}

export function useWaiting(person: string | null) {
  const params = person ? { person } : {}
  const { reads, reload: reloadInbox } = useHostPoll<InboxListPayload>(
    'pilot.inbox.list',
    params,
    REFRESH_MS
  )
  const { reads: queueReads, reload: reloadQueue } = useHostPoll<QueueListPayload>(
    'pilot.queue.list',
    params,
    REFRESH_MS
  )
  const inbox = useHeldMerge(reads, mergeInbox)
  const queue = useHeldMerge(queueReads, mergeQueue) ?? []
  // Each kind says its own failure; HostsNotice names the machines when only some failed.
  const error = mergedError(reads) ?? mergedError(queueReads)
  const loadedAt = useLoadedAt(reads)
  const reload = useCallback(async () => {
    await Promise.all([reloadInbox(), reloadQueue()])
  }, [reloadInbox, reloadQueue])

  // Error text for the card (the card changed, it closed meanwhile), or null once saved.
  const save = useCallback(
    async (
      item: InboxListRow,
      answer: { option: number | null; text: string },
      by: string | null
    ) => {
      try {
        await pilotRpc('pilot.inbox.answer', {
          id: item.id,
          text: answer.text,
          ...(answer.option === null ? {} : { option: answer.option }),
          digest: item.digest,
          ...(by ? { by } : {})
        })
        await reload()
        return null
      } catch (e) {
        await reload()
        return errorText(e)
      }
    },
    [reload]
  )

  // A person's Retry on a blocked preparation: null once requeued, else why not.
  const retryPreparation = useCallback(
    async (item: InboxListRow) => {
      try {
        await pilotRpc('pilot.inbox.prepareRetry', { id: item.id })
        await reload()
        return null
      } catch (e) {
        await reload()
        return errorText(e)
      }
    },
    [reload]
  )

  // R-P5: a person's Prepare evidence on a never-prepared push or drafted card.
  const prepareEvidence = useCallback(
    async (item: InboxListRow) => {
      try {
        await pilotRpc('pilot.inbox.prepareEvidence', { id: item.id })
        await reload()
        return null
      } catch (e) {
        await reload()
        return errorText(e)
      }
    },
    [reload]
  )

  // What the pass did, in a line, so Apply now always says something (even "2 still held").
  const applyNow = useCallback(async () => {
    try {
      const report = await pilotRpc<DispatchReport>(
        'pilot.answers.applyNow',
        {},
        { timeoutMs: APPLY_TIMEOUT_MS }
      )
      await reload()
      return { said: applyReport(report), failed: false }
    } catch (e) {
      return { said: errorText(e), failed: true }
    }
  }, [reload])

  return {
    inbox,
    queue,
    reads,
    queueReads,
    error,
    loadedAt,
    reload,
    save,
    retryPreparation,
    prepareEvidence,
    applyNow
  }
}
