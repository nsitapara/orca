import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { addImportedHandled } from './__fixtures__/imported-rows'
import { PilotStore } from './store'

let store: PilotStore
beforeEach(() => {
  store = PilotStore.open(join(mkdtempSync(join(tmpdir(), 'pilot-markers-')), 'p.db'))
})
afterEach(() => store.close())

function handledBy(automationId: string, key: string, at: number, runStatus: string | null): void {
  let runId: string | null = null
  if (runStatus) {
    runId = `${automationId}-${at}`
    store.runs.create({
      id: runId,
      automationId,
      tickId: null,
      itemKey: 'wt:x',
      itemLabel: 'x',
      worktreePath: '/wt/x',
      startedAt: at
    })
    store.runs.update(runId, { status: runStatus as never, finishedAt: at + 1 })
  }
  store.markHandled(automationId, key, runId, at)
}

describe('MarkerStore.progressMarkers', () => {
  it('takes the newest baselined or finished-well key per worktree, for this automation only', () => {
    handledBy('review', 'repo::/wt/a@aaaaaaa', 1, null) // baseline
    handledBy('review', 'repo::/wt/a@bbbbbbb', 2, 'done')
    handledBy('review', 'repo::/wt/a@ccccccc', 3, 'failed') // a failed cycle moves nothing
    handledBy('review', 'repo::/wt/a@ddddddd', 4, 'running') // nor does one still running
    handledBy('review', 'repo::/wt/b@eeeeeee', 5, null)
    handledBy('review', 'repo::/wt/c@1111111', 6, 'needs_you') // finished, left me questions
    handledBy('qa', 'repo::/wt/a@fffffff', 7, 'done') // another automation's progress
    handledBy('review', '!1561:15610', 8, 'done') // not a worktree key
    handledBy('review', `repo::/wt/d@${'a'.repeat(64)}`, 9, 'done') // a sha-256 head
    handledBy('review', 'repo::/wt/e@9999999', 10, 'running') // run still going...
    store.setHandledStatus('review', 'review-10', 'done', 11) // ...but its key settled done
    addImportedHandled(store, 'review', [
      { onceKey: 'repo::/wt/f@2222222', status: 'failed', at: 12, failedAt: 12 }
    ]) // a sweep's failure, imported: no progress
    addImportedHandled(store, 'review', [
      { onceKey: 'repo::/wt/b@3333333', status: 'failed', at: 13, failedAt: 13 }
    ]) // nor after a baseline
    addImportedHandled(store, 'review', [
      { onceKey: 'repo::/wt/g@4444444', status: 'done', at: 14, failedAt: null }
    ]) // a sweep's tested head, imported
    expect(store.markers.progressMarkers('review')).toEqual(
      new Map([
        ['repo::/wt/a', 'bbbbbbb'],
        ['repo::/wt/b', 'eeeeeee'],
        ['repo::/wt/c', '1111111'],
        ['repo::/wt/d', 'a'.repeat(64)],
        ['repo::/wt/e', '9999999'],
        ['repo::/wt/g', '4444444']
      ])
    )
  })
})
