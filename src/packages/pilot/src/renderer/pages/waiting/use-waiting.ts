import { useCallback } from 'react'
import type { InboxListRow } from '../../../shared/api-types'
import type {
  DispatchReport,
  InboxListPayload,
  QueueListPayload
} from '../../../shared/inbox-types'
import { useHeldMerge } from '../../hosts/held-merge'
import { useHostPoll } from '../../hosts/host-poll'
import { hostRpc } from '../../hosts/host-rpc'
import { useLoadedAt } from '../../hosts/loaded-at'
import { mergedError, mergeInbox, mergeQueue } from '../../hosts/merge-inbox'
import { LOCAL_PILOT_HOST, type Hosted, type PilotHostEntry } from '../../hosts/pilot-host'
import { currentPilotHosts } from '../../hosts/pilot-hosts-feed'
import { errorText } from '../format'
import { applyReport } from './answer-text'
import type { ApplyResult } from './InMotionPanel'

const REFRESH_MS = 10_000
// Apply now may run actions (act.py allows 10 min) before it answers.
const APPLY_TIMEOUT_MS = 660_000

export function sumDispatchReports(reports: readonly DispatchReport[]): DispatchReport {
  return reports.reduce<DispatchReport>(
    (sum, r) => ({
      retired: sum.retired + r.retired,
      ticked: sum.ticked + r.ticked,
      actions: sum.actions + r.actions,
      agents: sum.agents + r.agents,
      held: sum.held + r.held,
      reasked: sum.reasked + r.reasked
    }),
    { retired: 0, ticked: 0, actions: 0, agents: 0, held: 0, reasked: 0 }
  )
}

// Machines that apply answers: online, and not reporting their scheduler off (an older engine reports nothing).
// With none, this machine (the browser's server) is still asked, so its own reply shows as before.
function applyingHosts(listed: readonly PilotHostEntry[]): PilotHostEntry[] {
  const running = listed.filter((h) => h.state === 'online' && h.schedulerOn !== false)
  if (running.length > 0) {
    return running
  }
  return [listed.find((h) => h.local) ?? LOCAL_PILOT_HOST]
}

// The summed pass, then what each machine couldn't; a failure names its machine once more than one is listed.
function applyResult(
  named: boolean,
  hosts: readonly PilotHostEntry[],
  settled: readonly PromiseSettledResult<DispatchReport>[]
): ApplyResult {
  const reports = settled.flatMap((s) => (s.status === 'fulfilled' ? [s.value] : []))
  const failures = settled.flatMap((s, i) =>
    s.status === 'rejected' ? [{ host: hosts[i], text: errorText(s.reason) }] : []
  )
  const lines = failures.map((f) => {
    if (!named) {
      return f.text
    }
    return `${f.host.machineName} couldn't apply: ${f.text}`
  })
  const said = [...(reports.length > 0 ? [applyReport(sumDispatchReports(reports))] : []), ...lines]
  return { said: said.join(' · '), failed: failures.length > 0 }
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
  // Every card action goes to the card's own machine; this machine's keep their exact call.
  const save = useCallback(
    async (
      item: Hosted<InboxListRow>,
      answer: { option: number | null; text: string },
      by: string | null
    ) => {
      try {
        await hostRpc(item.host, 'pilot.inbox.answer', {
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
    async (item: Hosted<InboxListRow>) => {
      try {
        await hostRpc(item.host, 'pilot.inbox.prepareRetry', { id: item.id })
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
    async (item: Hosted<InboxListRow>) => {
      try {
        await hostRpc(item.host, 'pilot.inbox.prepareEvidence', { id: item.id })
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
  const applyNow = useCallback(async (): Promise<ApplyResult> => {
    const listed = currentPilotHosts()
    const hosts = applyingHosts(listed)
    const settled = await Promise.allSettled(
      hosts.map((host) =>
        hostRpc<DispatchReport>(host, 'pilot.answers.applyNow', {}, { timeoutMs: APPLY_TIMEOUT_MS })
      )
    )
    if (settled.some((s) => s.status === 'fulfilled')) {
      await reload()
    }
    return applyResult(listed.length > 1, hosts, settled)
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
