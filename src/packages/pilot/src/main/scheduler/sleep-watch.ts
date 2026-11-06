// Whether the Mac slept: a heartbeat that beats every BEAT_MS and finds the gaps far longer than that. Pilot's own
// clocks (Date.now, timers) run on through sleep, so a timer that started before sleep fires just after the wake, and
// a glab call that straddled the sleep is killed as timed out though GitLab never saw it. A tick that failed that way
// is interrupted, not failed (tick-runner). A main thread blocked for SLEEP_GAP_MS reads as a sleep too.
export const BEAT_MS = 5_000
export const SLEEP_GAP_MS = 60_000
// Gaps older than this can't overlap a tick still running (a tick's glab calls time out long before).
const KEEP_MS = 24 * 60 * 60_000

type Gap = { from: number; to: number }

export class SleepWatch {
  private lastBeat: number
  private gaps: Gap[] = []
  private timer: NodeJS.Timeout | null = null

  constructor(private readonly now: () => number) {
    this.lastBeat = now()
  }

  start(): void {
    if (this.timer) {
      return
    }
    this.lastBeat = this.now()
    this.timer = setInterval(() => this.beat(), BEAT_MS)
    this.timer.unref?.()
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer)
      this.timer = null
    }
  }

  beat(): void {
    const at = this.now()
    if (at - this.lastBeat > SLEEP_GAP_MS) {
      this.gaps.push({ from: this.lastBeat, to: at })
    }
    this.lastBeat = at
    this.gaps = this.gaps.filter((g) => at - g.to < KEEP_MS)
  }

  // True when a sleep began after `since`, or one is still unbeaten: a timer that fires on wake can run before
  // the heartbeat's, so the gap since the last beat counts too.
  sleptSince(since: number): boolean {
    if (this.now() - this.lastBeat > SLEEP_GAP_MS) {
      return true
    }
    return this.gaps.some((g) => g.to > since)
  }
}
