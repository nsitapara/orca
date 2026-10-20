import { ExternalLink, MonitorUp } from 'lucide-react'
import { JiraIcon } from '@/components/icons/JiraIcon'
import { LinearIcon } from '@/components/icons/LinearIcon'
import {
  WorktreeCardDetailSection,
  WorktreeCardDetailSectionContent
} from '@/components/sidebar/WorktreeCardDetailSection'
import { DetailHeader, MetadataActionIcon } from '@/components/sidebar/WorktreeCardMetadataControls'
import { LinearStateBadge } from '@/components/sidebar/WorktreeCardMetadataStatusBadges'
import { Badge } from '@/components/ui/badge'
import type { useHoverCardDetails } from './use-hover-card-details'

type Secondary = ReturnType<typeof useHoverCardDetails>['secondary']

// Upstream's hover card Linear section (activity-thread-hover-card.tsx); its state badge also gets the state type.
export function HoverCardLinearSection({
  issue,
  onOpenInOrca
}: {
  issue: NonNullable<Secondary['hoverLinearIssue']>
  onOpenInOrca?: (event: React.MouseEvent) => void
}): React.JSX.Element {
  const labels = issue.labels ?? []
  return (
    <WorktreeCardDetailSection>
      <DetailHeader
        icon={<LinearIcon className="size-3 text-muted-foreground" />}
        label={`Linear ${issue.identifier}`}
        actions={
          <>
            {issue.url && onOpenInOrca ? (
              <MetadataActionIcon label="Open in Pilot" onClick={onOpenInOrca}>
                <MonitorUp className="size-3" />
              </MetadataActionIcon>
            ) : null}
            {issue.url ? (
              <MetadataActionIcon label="View on Linear" href={issue.url}>
                <ExternalLink className="size-3" />
              </MetadataActionIcon>
            ) : null}
          </>
        }
      />
      <WorktreeCardDetailSectionContent className="space-y-1.5">
        <div className="text-[13px] font-semibold leading-snug text-foreground break-words">
          {issue.title}
        </div>
        {labels.length > 0 || issue.stateName ? (
          <div className="flex flex-wrap gap-1">
            {issue.stateName ? (
              <LinearStateBadge stateName={issue.stateName} stateType={issue.stateType} />
            ) : null}
            {labels.map((label) => (
              <Badge key={label} variant="outline" className="h-4 px-1.5 text-[9px]">
                {label}
              </Badge>
            ))}
          </div>
        ) : null}
      </WorktreeCardDetailSectionContent>
    </WorktreeCardDetailSection>
  )
}

// Upstream's hover card Jira section.
export function HoverCardJiraSection({
  issue
}: {
  issue: NonNullable<Secondary['hoverJiraIssue']>
}): React.JSX.Element {
  return (
    <WorktreeCardDetailSection>
      <DetailHeader
        icon={<JiraIcon className="size-3 text-muted-foreground" />}
        label={`Jira ${issue.identifier}`}
        actions={
          <MetadataActionIcon label="View on Jira" href={issue.url}>
            <ExternalLink className="size-3" />
          </MetadataActionIcon>
        }
      />
      <WorktreeCardDetailSectionContent>
        <div className="text-[13px] font-semibold leading-snug text-foreground break-words">
          {issue.title}
        </div>
      </WorktreeCardDetailSectionContent>
    </WorktreeCardDetailSection>
  )
}
