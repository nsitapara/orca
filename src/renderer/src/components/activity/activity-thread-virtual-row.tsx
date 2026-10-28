import type React from 'react'
import { translate } from '@/i18n/i18n'
import { clearActivityThread, isClearableActivityThread } from './activity-clear-completed'
import { ActivityStatusGroupHeader } from './activity-thread-controls'
import { ActivityThreadContextMenu } from './activity-thread-context-menu'
import type { ActivityThreadRow } from './activity-thread-row' // pilot-hook: activity-tabs-thread-row
import type { AgentPaneThread } from './activity-thread-types'
import type { ActivityVirtualItemDescriptor } from './activity-thread-virtual-items'
import { ActivityTabsVirtualRow } from '../../../../packages/pilot/src/renderer/activity-tabs/WorkspaceTabRow' // pilot-hook: activity-tabs-row
import { ActivityTabsGroupHeader } from '../../../../packages/pilot/src/renderer/activity-tabs/ActivityTabsGroupHeader' // pilot-hook: activity-tabs-group-header
import { ActivityTabsNest } from '../../../../packages/pilot/src/renderer/activity-tabs/ActivityTabsNest' // pilot-hook: activity-tabs-nest
import { ActivityTabsThreadRow } from '../../../../packages/pilot/src/renderer/activity-tabs/ActivityTabsThreadRow' // pilot-hook: activity-tabs-thread-row

type ContextMenuProps = Parameters<typeof ActivityThreadContextMenu>[0]

export function ActivityThreadVirtualRow({
  item,
  collapsed,
  onToggleGroup,
  selectedPaneKey,
  multiSelectedKeys,
  onSelectThread,
  onOpenThread,
  getContextMenuTargets,
  onJumpToWorkspace,
  onMarkThreadRead,
  onMarkThreadUnread,
  onMarkThreadsRead,
  onMarkThreadsUnread,
  canJumpToWorkspace,
  canMarkThreadUnread,
  compactMode,
  showJumpAction
}: {
  item: ActivityVirtualItemDescriptor
  collapsed: boolean
  onToggleGroup: (groupKey: string) => void
  selectedPaneKey: string | null
  multiSelectedKeys: ReadonlySet<string>
  onSelectThread: Parameters<typeof ActivityThreadRow>[0]['onSelect']
  onOpenThread: ContextMenuProps['onOpen']
  getContextMenuTargets: ContextMenuProps['getTargets']
  onJumpToWorkspace: Parameters<typeof ActivityThreadRow>[0]['onJump']
  onMarkThreadRead: Parameters<typeof ActivityThreadRow>[0]['onMarkRead']
  onMarkThreadUnread: Parameters<typeof ActivityThreadRow>[0]['onMarkUnread']
  onMarkThreadsRead: ContextMenuProps['onMarkManyRead']
  onMarkThreadsUnread: ContextMenuProps['onMarkManyUnread']
  canJumpToWorkspace: (thread: AgentPaneThread) => boolean
  canMarkThreadUnread: (thread: AgentPaneThread) => boolean
  compactMode: boolean
  showJumpAction: boolean
}): React.JSX.Element {
  if (item.type === 'header') {
    return (
      <div
        role="group"
        aria-label={translate(
          'auto.components.activity.ActivityPrototypePage.a2b4437bfb',
          '{{value0}} activity',
          { value0: item.group.label }
        )}
        className="pb-1"
      >
        <ActivityTabsGroupHeader
          group={item.group}
          collapsed={collapsed}
          onToggle={() => onToggleGroup(item.group.key)}
        >
          {/* pilot-hook: activity-tabs-group-header */}
          <ActivityStatusGroupHeader
            group={item.group}
            collapsed={collapsed}
            onToggle={() => onToggleGroup(item.group.key)}
          />
        </ActivityTabsGroupHeader>
      </div>
    )
  }
  if (item.type === 'workspace-tab') {
    return <ActivityTabsVirtualRow item={item} compactMode={compactMode} /> // pilot-hook: activity-tabs-row
  }
  const canJump = canJumpToWorkspace(item.thread)
  const isOpen = item.thread.paneKey === selectedPaneKey
  return (
    <ActivityThreadContextMenu
      thread={item.thread}
      canJump={canJump}
      canMarkUnread={canMarkThreadUnread}
      getTargets={getContextMenuTargets}
      onOpen={onOpenThread}
      onJump={onJumpToWorkspace}
      onMarkRead={onMarkThreadRead}
      onMarkUnread={onMarkThreadUnread}
      onMarkManyRead={onMarkThreadsRead}
      onMarkManyUnread={onMarkThreadsUnread}
    >
      {(menuOpen) => (
        // Why the menu wraps this wrapper, not the row: the row is already the hover-card
        // trigger, and stacking two Radix triggers on one node composes their refs.
        <div className="pb-0.5">
          <ActivityTabsNest groupKey={item.groupKey}>
            {/* pilot-hook: activity-tabs-nest, activity-tabs-thread-row */}
            <ActivityTabsThreadRow
              thread={item.thread}
              selected={isOpen}
              multiSelected={!isOpen && multiSelectedKeys.has(item.thread.paneKey)}
              onSelect={onSelectThread}
              onJump={onJumpToWorkspace}
              onMarkRead={onMarkThreadRead}
              onMarkUnread={onMarkThreadUnread}
              onClear={isClearableActivityThread(item.thread) ? clearActivityThread : undefined}
              canJump={canJump}
              compactMode={compactMode}
              disableMarkUnread={!canMarkThreadUnread(item.thread)}
              showJumpAction={showJumpAction}
              previewSuppressed={menuOpen}
            />
          </ActivityTabsNest>
        </div>
      )}
    </ActivityThreadContextMenu>
  )
}
