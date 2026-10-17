import { useCallback, useEffect, useRef, useState } from 'react'
import type { InboxListRow } from '../../../shared/api-types'
import type { InboxListPayload, QueueEntry, QueueListPayload } from '../../../shared/inbox-types'
import { pilotRpc } from '../../api'
import { errorText } from '../format'

const REFRESH_MS = 10_000
// Apply now may run actions (act.py allows 10 min) before it answers.
const APPLY_TIMEOUT_MS = 660_000

export function useWaiting(person: string | null) {
  const [inbox, setInbox] = useState<InboxListPayload | null>(null)
  const [queue, setQueue] = useState<QueueEntry[]>([])
  const [error, setError] = useState<string | null>(null)
  // When the list was read: card ages are measured from it, so a render never reads the clock.
  const [loadedAt, setLoadedAt] = useState(0)
  const mounted = useRef(true)
  const reload = useCallback(async () => {
    const params = person ? { person } : {}
    try {
      const [items, queued] = await Promise.all([
        pilotRpc<InboxListPayload>('pilot.inbox.list', params),
        pilotRpc<QueueListPayload>('pilot.queue.list', params)
      ])
      if (!mounted.current) {
        return
      }
      setInbox(items)
      setLoadedAt(Date.now())
      setQueue(queued.entries)
      setError(null)
    } catch (e) {
      if (mounted.current) {
        setError(errorText(e))
      }
    }
  }, [person])
  useEffect(() => {
    mounted.current = true
    void reload()
    const timer = setInterval(() => void reload(), REFRESH_MS)
    return () => {
      mounted.current = false
      clearInterval(timer)
    }
  }, [reload])

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

  const applyNow = useCallback(async () => {
    try {
      await pilotRpc('pilot.answers.applyNow', {}, { timeoutMs: APPLY_TIMEOUT_MS })
      await reload()
      return null
    } catch (e) {
      return errorText(e)
    }
  }, [reload])

  return {
    inbox,
    queue,
    error,
    loadedAt,
    reload,
    save,
    retryPreparation,
    prepareEvidence,
    applyNow
  }
}
