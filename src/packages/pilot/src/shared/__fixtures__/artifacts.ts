import type { AgentArtifact } from '../api-types-artifacts'

// Tests only: rows shaped as `pilotcli artifacts list-artifacts` prints them (pilotCLI's output contract).
export const WT = '/Users/dev/worktrees/web-platform'
export const PARENT_WT = `${WT}/web-1982-improve-ordering-system`
export const CHILD_WT = `${WT}/web-2283-rework-the-order-creation-workflow`
export const FOLDER_WT = '/Users/dev/notes'

export const ORDERS: AgentArtifact = {
  id: 'Cj42H6x4MfQTyUhnBBE58k',
  source: 'claude',
  url: 'https://claude.ai/artifact/Cj42H6x4MfQTyUhnBBE58k',
  title: 'Orders Rework',
  description: 'Prototype of a simpler staff New order page',
  tickets: ['WEB-1982', 'WEB-2283'],
  worktrees: [PARENT_WT, CHILD_WT],
  versions: 52,
  first_published: '2026-10-15T17:49:00Z',
  last_published: '2026-10-29T21:05:00Z',
  tracked: true,
  on_account: true,
  job: '',
  contributions: [
    {
      session_id: '0a1b2c3d-0000-4000-8000-000000000001',
      role: 'mockup-keeper',
      job: '',
      worktree: PARENT_WT,
      branch: 'web-1982-improve-ordering-system',
      publishes: 50,
      first: '2026-10-15T17:49:00Z',
      last: '2026-10-29T21:05:00Z'
    },
    {
      session_id: '0a1b2c3d-0000-4000-8000-000000000002',
      role: 'sub-issue-worker',
      job: '',
      worktree: CHILD_WT,
      branch: 'web-2283-rework-the-order-creation-workflow',
      publishes: 2,
      first: '2026-10-22T21:44:00Z',
      last: '2026-10-22T22:10:00Z'
    }
  ],
  source_files: [
    '/private/tmp/claude-501/-Users-dev/0a1b2c3d/scratchpad/orders.html',
    '/Users/dev/worktrees/web-platform/web-1982-improve-ordering-system/docs/orders.html'
  ],
  vault_notes: ['Agent Work/Orders rework prototype.md']
}

export const NOTES_PAGE: AgentArtifact = {
  ...ORDERS,
  id: 'NotesPage00000000000001',
  url: 'https://claude.ai/artifact/NotesPage00000000000001',
  title: 'Reading list',
  description: 'Notes folder page',
  tickets: [],
  worktrees: [FOLDER_WT],
  versions: 3,
  first_published: '2026-10-20T10:00:00Z',
  last_published: '2026-10-20T11:00:00Z',
  contributions: [
    {
      session_id: '0a1b2c3d-0000-4000-8000-000000000003',
      role: 'interactive',
      job: '',
      worktree: FOLDER_WT,
      branch: '',
      publishes: 3,
      first: '2026-10-20T10:00:00Z',
      last: '2026-10-20T11:00:00Z'
    }
  ],
  source_files: [],
  vault_notes: []
}

export const TOKEN_REPORT: AgentArtifact = {
  id: 'Agent Work/Automations/08 · Tally token usage by job/Token usage.html',
  source: 'local',
  url: '/Users/dev/Vault/Agent Work/Automations/08 · Tally token usage by job/Token usage.html',
  title: 'Token usage by job',
  description: '',
  tickets: [],
  worktrees: [],
  versions: 1,
  first_published: '2026-10-30T00:53:00Z',
  last_published: '2026-10-30T18:12:41Z',
  tracked: true,
  on_account: false,
  job: '08 · Tally token usage by job',
  contributions: [],
  source_files: [],
  vault_notes: []
}

export const UNTRACKED: AgentArtifact = {
  ...TOKEN_REPORT,
  id: 'GeXjQZFcR9ZxGxS98hkyDx',
  source: 'claude',
  url: 'https://claude.ai/artifact/GeXjQZFcR9ZxGxS98hkyDx',
  title: 'Carrier physician picker',
  job: '',
  tracked: false,
  on_account: true,
  last_published: '2026-10-29T00:00:00Z'
}

export const ARTIFACTS: AgentArtifact[] = [TOKEN_REPORT, ORDERS, UNTRACKED, NOTES_PAGE]

export function artifactsEnvelope(data: unknown) {
  return { v: 1, command: 'artifacts list-artifacts', outcome: 'ok', reason: '', data }
}
