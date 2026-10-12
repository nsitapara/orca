import {
  codexQuotaReading,
  type CodexRateLimitsResult
} from '../../src/main/fields/codex-quota-reading'
import type { QuotaReading } from '../../src/main/fields/quota'
import type { BusyReads } from '../../src/main/fields/worktree-busy'
import type { AgentKind } from '../../src/shared/definition/types'
import { orcaResult, type ParityFixture } from './fixture-core'

const UNKNOWN_QUOTA: QuotaReading = { weekly: null, session: null }

// The quota the old sweep read (quota.py), as the case saved it: Claude's `{ weekly, session }` percentages in
// state `quota/claude.json`, else the case's `quota` field. A case without one has an unknown quota, which lets a
// job run. Codex's raw answer is in state `quota/codex-rate-limits.json`.
export function fixtureQuota(f: ParityFixture, agent: AgentKind): QuotaReading {
  if (agent === 'codex') {
    // Codex's raw `account/rateLimits/read` answer, as quota.py read it (null: unreadable).
    if ('quota/codex-rate-limits.json' in f.state) {
      const raw = f.state['quota/codex-rate-limits.json']
      return raw ? codexQuotaReading(raw as CodexRateLimitsResult, f.now) : UNKNOWN_QUOTA
    }
    return f.quota?.codex ?? UNKNOWN_QUOTA
  }
  const saved = (f.state['quota/claude.json'] ?? f.quota?.claude) as
    | Partial<QuotaReading>
    | null
    | undefined
  return { weekly: saved?.weekly ?? null, session: saved?.session ?? null }
}

// The reads gate.py's worktree_busy makes, answered from the recording: one the case lacks is a miss,
// which worktreeBusy reports as "could not be read" (and parity-case.ts fails the case on).
export function fixtureBusyReads(f: ParityFixture): BusyReads {
  return {
    draft: async (handle) => {
      const read = orcaResult<{ terminal: { draft?: string | null } }>(f, [
        'terminal',
        'read',
        '--terminal',
        handle
      ])
      return read.terminal.draft ?? ''
    },
    agentStates: async () => {
      const ps = orcaResult<{ worktrees: { agents?: { paneKey: string; state: string }[] }[] }>(f, [
        'worktree',
        'ps',
        '--limit',
        '1000'
      ])
      return new Map(ps.worktrees.flatMap((w) => (w.agents ?? []).map((a) => [a.paneKey, a.state])))
    },
    tabBusy: async (handle) => {
      const wait = orcaResult<{ wait: { satisfied: boolean } }>(f, [
        'terminal',
        'wait',
        '--terminal',
        handle,
        '--for',
        'tui-idle',
        '--timeout-ms',
        '1500'
      ])
      return !wait.wait.satisfied
    }
  }
}
