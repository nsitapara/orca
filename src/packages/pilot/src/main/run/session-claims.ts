// Who is about to start a process on an agent session. A launch or a Resume looks for the session's
// tab, finds none, and starts `--resume S`; until the new agent posts its first status row nothing
// else shows it, so a second caller in that window would start a second process. A claim closes the
// window: taken (synchronously) before the look, held until the new tab's first row for S is seen or
// the TTL passes, released at once when the start fails or needed no new process.
export const CLAIM_TTL_MS = 90_000

export type ClaimResult = { ok: true } | { ok: false; by: string; handle: string | null }
export type SessionClaimTable = {
  // Drops a held claim once a tab shows the session (the start it guarded has landed).
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
    // Whether any live tab holds the session now (session-tabs.ts).
    private readonly seen: (sessionId: string) => Promise<boolean> = async () => false,
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
      if (await this.seen(sessionId)) {
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
