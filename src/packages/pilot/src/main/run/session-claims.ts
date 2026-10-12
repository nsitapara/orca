// Who is about to start a process on an agent session. A launch or a Resume looks for the session's
// tab, finds none, and starts `--resume S`; until the new agent posts its first status row nothing
// else shows it, so a second caller in that window would start a second process. A claim closes the
// window: taken (synchronously) before the look, held until the start is judged landed (a live tab shows
// a row for S from after the claim began) or dead (its terminal closed), the TTL passes, or the holder
// releases it because the start failed or needed no new process.
export const CLAIM_TTL_MS = 90_000
// A just-opened terminal may not be listed yet: a start is only called dead after this long.
export const DEAD_GRACE_MS = 10_000

export type ClaimVerdict = 'landed' | 'dead' | 'pending'
export type ClaimResult = { ok: true } | { ok: false; by: string; handle: string | null }
export type SessionClaimTable = {
  // Drops a held claim once its start has landed or died (judged by the table's judge).
  expireIfSeen(sessionId: string): Promise<void>
  acquire(sessionId: string, by: string): ClaimResult
  // The new terminal the holder opened, so a second caller can be sent to it.
  setHandle(sessionId: string, by: string, handle: string): void
  release(sessionId: string, by: string): void
  holder(sessionId: string): { by: string; handle: string | null } | null
}

type Claim = { by: string; since: number; handle: string | null }

export class SessionClaims implements SessionClaimTable {
  private readonly claims = new Map<string, Claim>()

  constructor(
    private readonly now: () => number = Date.now,
    // How the start this claim guards is going (judgeClaim); without one a claim lasts to its TTL.
    private readonly judge: (
      sessionId: string,
      claim: { since: number; handle: string | null }
    ) => Promise<ClaimVerdict> = async () => 'pending',
    private readonly ttlMs: number = CLAIM_TTL_MS
  ) {}

  private live(sessionId: string): Claim | null {
    const claim = this.claims.get(sessionId)
    if (!claim) {
      return null
    }
    if (this.now() - claim.since >= this.ttlMs) {
      this.claims.delete(sessionId)
      return null
    }
    return claim
  }

  async expireIfSeen(sessionId: string): Promise<void> {
    const claim = this.live(sessionId)
    if (!claim) {
      return
    }
    try {
      const verdict = await this.judge(sessionId, { since: claim.since, handle: claim.handle })
      if (verdict !== 'pending') {
        // Only the claim this call looked at: a new one taken meanwhile stays.
        if (this.claims.get(sessionId) === claim) {
          this.claims.delete(sessionId)
        }
      }
    } catch {
      // Can't tell: the claim stays until its TTL.
    }
  }

  acquire(sessionId: string, by: string): ClaimResult {
    const held = this.live(sessionId)
    if (held && held.by !== by) {
      return { ok: false, by: held.by, handle: held.handle }
    }
    this.claims.set(sessionId, { by, since: this.now(), handle: held?.handle ?? null })
    return { ok: true }
  }

  setHandle(sessionId: string, by: string, handle: string): void {
    const held = this.live(sessionId)
    if (held?.by === by) {
      held.handle = handle
    }
  }

  release(sessionId: string, by: string): void {
    if (this.claims.get(sessionId)?.by === by) {
      this.claims.delete(sessionId)
    }
  }

  holder(sessionId: string): { by: string; handle: string | null } | null {
    const held = this.live(sessionId)
    return held ? { by: held.by, handle: held.handle } : null
  }
}

export type ClaimJudgeDeps = {
  // Every terminal Orca says holds the session, with the time of its newest live (not session-only) row for it.
  panes(
    sessionId: string
  ): Promise<{ handle: string; paneKey: string | null; rowAt: number | null }[]>
  // The launcher's own judgement of a tab (sessionTerminalState).
  state(
    terminal: { handle: string; paneKey: string | null },
    sessionId: string
  ): Promise<'free' | 'other' | 'busy' | 'gone'>
  isOpen(handle: string): Promise<boolean>
}

// landed: a tab that is not gone shows a live row for the session from after the claim began. A surviving
// shell's session-only remnant row never counts (it has no live row, and its tab reads gone). dead: the
// terminal the start opened is no longer connected. Otherwise pending.
export async function judgeClaim(
  deps: ClaimJudgeDeps,
  sessionId: string,
  claim: { since: number; handle: string | null },
  now: number
): Promise<ClaimVerdict> {
  for (const pane of await deps.panes(sessionId)) {
    if (pane.rowAt === null || pane.rowAt < claim.since) {
      continue
    }
    const state = await deps.state(pane, sessionId)
    if (state === 'free' || state === 'busy') {
      return 'landed'
    }
  }
  if (claim.handle && now - claim.since >= DEAD_GRACE_MS && !(await deps.isOpen(claim.handle))) {
    return 'dead'
  }
  return 'pending'
}
