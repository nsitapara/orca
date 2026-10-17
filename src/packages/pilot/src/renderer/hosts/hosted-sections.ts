import type { InboxListRow } from '../../shared/api-types'
import { compareGroups, groupItems, type InboxGroup } from '../../shared/inbox-groups'
import type { InboxListPayload } from '../../shared/inbox-types'
import { groupByHost, hostedKey, type Hosted, type PilotHostRef } from './pilot-host'

export type HostedSection = {
  // hostedKey(host, group.key): the filter's value and the section's React key.
  key: string
  host: PilotHostRef
  group: InboxGroup
  items: Hosted<InboxListRow>[]
}

// Grouped per machine, so the same worktree path on two machines is two sections, never one.
export function groupHostedItems(
  items: readonly Hosted<InboxListRow>[],
  automations: InboxListPayload['automations']
): HostedSection[] {
  const byHost = groupByHost(items)
  const order = new Map(byHost.map(({ host }, at) => [host.key, at]))
  const sections = byHost.flatMap(({ host, items: own }) =>
    groupItems(own, automations).map((s) => ({
      key: hostedKey(host, s.group.key),
      host,
      group: s.group,
      items: s.items
    }))
  )
  return sections.sort(
    (a, b) =>
      compareGroups(a.group, b.group) || (order.get(a.host.key) ?? 0) - (order.get(b.host.key) ?? 0)
  )
}
