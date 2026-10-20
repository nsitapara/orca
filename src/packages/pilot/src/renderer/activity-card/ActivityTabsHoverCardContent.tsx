import { useCallback } from 'react'
import { Pencil, StickyNote } from 'lucide-react'
import { toast } from 'sonner'
import type { AgentPaneThread } from '@/components/activity/activity-thread-types'
import { SelectedTextCopyMenu } from '@/components/SelectedTextCopyMenu'
import CommentMarkdown from '@/components/sidebar/CommentMarkdown'
import { WorktreeCardAutomationDetailSection } from '@/components/sidebar/WorktreeCardAutomationDetailSection'
import { WorktreeCardCliDetailSection } from '@/components/sidebar/WorktreeCardCliDetailSection'
import {
  WorktreeCardDetailSection,
  WorktreeCardDetailSectionContent
} from '@/components/sidebar/WorktreeCardDetailSection'
import { WorktreeCardIssueDetailSection } from '@/components/sidebar/WorktreeCardIssueDetailSection'
import { DetailHeader, MetadataActionIcon } from '@/components/sidebar/WorktreeCardMetadataControls'
import { WorktreeCardReviewDetailSection } from '@/components/sidebar/WorktreeCardReviewDetailSection'
import { WORKTREE_NATIVE_CONTEXT_MENU_ATTR } from '@/components/sidebar/WorktreeContextMenu'
import type { useWorktreeCardDetailsHoverControl } from '@/components/sidebar/worktree-card-details-hover-state'
import { getReviewLabel } from '@/components/sidebar/worktree-review-helpers'
import { HoverCardContent } from '@/components/ui/hover-card'
import { pilotStore } from '../store'
import { HoverCardAgentSummary } from './HoverCardAgentSummary'
import { HoverCardPorts } from './HoverCardPorts'
import { HoverCardJiraSection, HoverCardLinearSection } from './HoverCardTicketSections'
import { HoverCardWorkspace } from './HoverCardWorkspace'
import { useHoverCardDetails } from './use-hover-card-details'
import { WorktreeLinkChips } from './WorktreeLinkChips'

type ContentProps = {
  thread: AgentPaneThread
  detailsHoverControl: ReturnType<typeof useWorktreeCardDetailsHoverControl>
  onJumpToWorkspace?: (thread: AgentPaneThread) => void
  canJumpToWorkspace?: boolean
}

async function copyLink(url: string, label: string): Promise<void> {
  try {
    await window.api.ui.writeClipboardText(url)
    toast.success(`${label} copied`)
  } catch {
    toast.error('Failed to copy link')
  }
}

function PilotHoverCardContent({
  thread,
  detailsHoverControl,
  onJumpToWorkspace,
  canJumpToWorkspace
}: ContentProps): React.JSX.Element {
  const { worktree, repo } = thread
  const { foundation, secondary } = useHoverCardDetails(thread, detailsHoverControl.hoverOpen)
  const { closeHover } = detailsHoverControl
  const dismissAndRun = useCallback(
    (handler: ((event: React.MouseEvent) => void) | undefined) => (event: React.MouseEvent) => {
      closeHover()
      handler?.(event)
    },
    [closeHover]
  )
  const issueUrl = secondary.hoverIssue?.url
  const review = secondary.hoverReview
  const comment = (secondary.hoverComment ?? '').trim()

  return (
    <HoverCardContent
      side="right"
      align="start"
      sideOffset={8}
      className="w-80 max-h-[30rem] overflow-y-auto p-3 text-xs scrollbar-sleek"
      {...{ [WORKTREE_NATIVE_CONTEXT_MENU_ATTR]: '' }}
      onClick={(event) => event.stopPropagation()}
      onDoubleClick={(event) => event.stopPropagation()}
    >
      <SelectedTextCopyMenu className="space-y-3">
        <WorktreeLinkChips worktree={worktree} repo={repo} size="card" />
        <HoverCardPorts worktree={worktree} repo={repo} ports={foundation.workspacePorts} />
        {secondary.hoverLinearIssue ? (
          <HoverCardLinearSection
            issue={secondary.hoverLinearIssue}
            onOpenInOrca={
              secondary.handleOpenLinearIssueInOrca
                ? dismissAndRun(secondary.handleOpenLinearIssueInOrca)
                : undefined
            }
          />
        ) : null}
        {secondary.hoverJiraIssue ? (
          <HoverCardJiraSection issue={secondary.hoverJiraIssue} />
        ) : null}
        <WorktreeCardIssueDetailSection
          issue={secondary.hoverIssue}
          issueMenuOpen={detailsHoverControl.issueMenuOpen}
          onIssueMenuOpenChange={detailsHoverControl.handleIssueMenuOpenChange}
          onCopyIssueLink={
            issueUrl
              ? () => {
                  closeHover()
                  void copyLink(issueUrl, 'Issue link')
                }
              : undefined
          }
          onEditIssue={foundation.handleEditIssue}
          onOpenGitHubIssueInOrca={
            secondary.handleOpenGitHubIssueInOrca
              ? dismissAndRun(secondary.handleOpenGitHubIssueInOrca)
              : undefined
          }
          onOpenIssueInBrowser={
            issueUrl
              ? (url: string) => {
                  closeHover()
                  secondary.handleOpenIssueInBrowser(url)
                }
              : undefined
          }
        />
        <WorktreeCardReviewDetailSection
          review={review}
          reviewMenuOpen={detailsHoverControl.reviewMenuOpen}
          onReviewMenuOpenChange={detailsHoverControl.handleReviewMenuOpenChange}
          onOpenReviewInOrca={secondary.handleOpenReviewInOrca}
          onOpenReviewInBrowser={review?.url ? secondary.handleOpenReviewInBrowser : undefined}
          onCopyReviewLink={
            review?.url
              ? () => void copyLink(review.url ?? '', `${getReviewLabel(review)} link`)
              : undefined
          }
          onUnlinkReview={secondary.canUnlinkReview ? secondary.handleUnlinkReview : undefined}
          closeHover={closeHover}
        />
        {secondary.metaAutomationProvenance ? (
          <WorktreeCardAutomationDetailSection
            provenance={secondary.metaAutomationProvenance}
            onOpenAutomation={
              foundation.handleOpenAutomation
                ? dismissAndRun(foundation.handleOpenAutomation)
                : undefined
            }
            onOpenAutomationRun={
              foundation.handleOpenAutomationRun
                ? dismissAndRun(foundation.handleOpenAutomationRun)
                : undefined
            }
          />
        ) : null}
        {secondary.metaCliProvenance ? (
          <WorktreeCardCliDetailSection provenance={secondary.metaCliProvenance} />
        ) : null}
        {comment ? (
          <WorktreeCardDetailSection>
            <DetailHeader
              icon={<StickyNote className="size-3 text-muted-foreground" />}
              label="Notes"
              actions={
                <MetadataActionIcon label="Edit notes" onClick={foundation.handleEditComment}>
                  <Pencil className="size-3" />
                </MetadataActionIcon>
              }
            />
            <WorktreeCardDetailSectionContent className="space-y-2">
              <CommentMarkdown
                content={comment}
                className="text-[11.5px] text-foreground break-words leading-normal [&_.comment-md-p]:block [&_.comment-md-p+.comment-md-p]:mt-1"
              />
            </WorktreeCardDetailSectionContent>
          </WorktreeCardDetailSection>
        ) : null}
        <HoverCardWorkspace
          thread={thread}
          onJumpToWorkspace={onJumpToWorkspace}
          canJumpToWorkspace={canJumpToWorkspace}
          closeHover={closeHover}
        />
        <HoverCardAgentSummary thread={thread} />
      </SelectedTextCopyMenu>
    </HoverCardContent>
  )
}

// pilot-hook: activity-tabs-hover-card. A session's hover card leads with what the row can't show:
// its MR and Linear links, then the stack's ports by name, the ticket and review, the workspace
// (with Reveal in Finder), and last the session summary the row already shows. Upstream's card
// (`fallback`) renders until Pilot attaches.
export function ActivityTabsHoverCardContent({
  fallback: Upstream,
  ...props
}: ContentProps & { fallback: (props: ContentProps) => React.JSX.Element }): React.JSX.Element {
  if (!pilotStore()) {
    return <Upstream {...props} />
  }
  return <PilotHoverCardContent {...props} />
}
