import { describe, expect, it } from 'vitest'
import type { RpcCallerIdentity } from '../../../../../main/runtime/rpc/rpc-caller-identity'
import type { PilotContext } from '../pilot-services'
import { buildTimelineMethods } from './methods-timeline'

type Callable = {
  name: string
  permission: string
  params: { safeParse(v: unknown): { success: boolean } }
  handler(p: unknown): unknown
}

function timelineMethod(): Callable {
  const ctx = {
    store: {
      timeline: { nextFor: () => [], openInbox: () => [], inboxForRuns: () => [] },
      runs: { forWorktree: () => [], steps: () => [] },
      usage: { costForWorktreeOn: () => ({ costUsd: 0, unpricedBuckets: 0 }) }
    },
    loaded: () => ({ definitions: [] }),
    scheduler: { nextTickAt: () => null }
  } as unknown as PilotContext
  return (buildTimelineMethods(() => ctx) as unknown as Callable[]).find(
    (m) => m.name === 'pilot.worktree.timeline'
  )!
}

describe('pilot.worktree.timeline', () => {
  it('returns the timeline shape for a worktree', () => {
    expect(timelineMethod().handler({ worktreePath: '/wt/a' })).toEqual({
      next: [],
      now: [],
      earlier: [],
      waiting: [],
      spentTodayUsd: 0,
      unpricedBuckets: 0
    })
  })

  it.each([
    [{ worktreePath: '/wt/a' }, true],
    [{ worktreePath: '/wt/a', person: 'nish' }, true],
    [{ worktreePath: '' }, false],
    [{}, false]
  ])('params %o valid: %s', (params, ok) => {
    expect(timelineMethod().params.safeParse(params).success).toBe(ok)
  })
})

describe('pilot.session.resume', () => {
  const DESKTOP: RpcCallerIdentity = { kind: 'desktop' }

  function resumeMethod(resumeSession?: unknown) {
    const ctx = { resumeSession } as unknown as PilotContext
    const found = (buildTimelineMethods(() => ctx) as unknown as Callable[]).find(
      (m) => m.name === 'pilot.session.resume'
    )!
    return found as unknown as {
      params: Callable['params']
      handler(p: unknown, rpc: { caller?: RpcCallerIdentity }): unknown
    }
  }

  it("hands the step to the process's resumer for the desktop", async () => {
    const resume = async (req: unknown) => ({ action: 'focused', handle: 'term_1', req })
    expect(
      await resumeMethod(resume).handler({ runId: 'r1', stepIdx: 0 }, { caller: DESKTOP })
    ).toMatchObject({
      action: 'focused',
      req: { runId: 'r1', stepIdx: 0 }
    })
  })

  it.each([
    ['local-cli (so any agent)', { kind: 'local-cli' } as RpcCallerIdentity | undefined],
    ['a paired device', { kind: 'paired-device', deviceId: 'd1' } as RpcCallerIdentity | undefined],
    ['no identity', undefined]
  ])('refuses %s without resuming anything', async (_name, caller) => {
    let called = false
    const resume = async () => {
      called = true
      return { action: 'opened', handle: 'x' }
    }
    const method = resumeMethod(resume)
    await expect(
      Promise.resolve().then(() => method.handler({ runId: 'r1', stepIdx: 0 }, { caller }))
    ).rejects.toThrow('Open sessions from Pilot')
    expect(called).toBe(false)
  })

  it.each([
    [{ runId: 'r1', stepIdx: 0 }, true],
    [{ runId: 'r1', stepIdx: -1 }, false],
    [{ runId: '', stepIdx: 0 }, false]
  ])('params %o valid: %s', (params, ok) => {
    expect(resumeMethod().params.safeParse(params).success).toBe(ok)
  })

  it('says so in a process with no runtime to resume in', async () => {
    await expect(
      Promise.resolve().then(() =>
        resumeMethod().handler({ runId: 'r1', stepIdx: 0 }, { caller: DESKTOP })
      )
    ).rejects.toThrow("Sessions can't be resumed in this process")
  })
})
