import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import Database from '../../../../../main/sqlite/sync-database'
import type { ItemDecision, Verdict } from '../../shared/api-types'
import { PilotStore } from './store'

const decision = (key: string, verdict: Verdict, path: string | null): ItemDecision =>
  ({
    key,
    label: key,
    verdict,
    reason: `why ${key}`,
    checks: [],
    onceKey: key,
    fields: path ? { 'worktree.path': path } : {}
  }) as ItemDecision

function setup(): { store: PilotStore; raw: Database } {
  const file = join(mkdtempSync(join(tmpdir(), 'pilot-timeline-')), 'db.sqlite')
  return { store: PilotStore.open(file), raw: new Database(file) }
}

function tick(
  store: PilotStore,
  automationId: string,
  decisions: ItemDecision[],
  opts: { running?: boolean } = {}
): number {
  const id = store.startTick(automationId, 1)
  store.recordDecisions(id, decisions, new Map())
  if (!opts.running) {
    store.finishTick(id, 'ok', null, {}, 2)
  }
  return id
}

function inbox(
  raw: Database,
  id: string,
  over: { run?: string; path?: string; person?: string; status?: string } = {}
): void {
  raw
    .prepare(
      `INSERT INTO inbox_items (id, automation_id, run_id, step_idx, item_key, worktree_path, person, type, title, context, digest, status, created_at, updated_at)
       VALUES (?, 'fix-ci', ?, 0, 'mr:1', ?, ?, 'question', ?, 'ctx', 'd', ?, ?, ?)`
    )
    .run(
      id,
      over.run ?? null,
      over.path ?? '/wt/a',
      over.person ?? 'nish',
      `Title ${id}`,
      over.status ?? 'open',
      Number(id.slice(1)),
      1
    )
}

describe('TimelineStore.nextFor', () => {
  it("reads each automation's newest finished tick, only this worktree's items, never out of scope", () => {
    const { store } = setup()
    tick(store, 'fix-ci', [
      decision('mr:1', 'skipped', '/wt/a'),
      decision('mr:2', 'started', '/wt/b')
    ])
    tick(store, 'fix-ci', [], { running: true })
    tick(store, 'review', [
      decision('mr:1', 'notdue', '/wt/a'),
      decision('mr:3', 'out_of_scope', '/wt/a')
    ])
    expect(
      store.timeline.nextFor('/wt/a').map((n) => [n.automationId, n.itemKey, n.verdict, n.reason])
    ).toEqual([
      ['fix-ci', 'mr:1', 'skipped', 'why mr:1'],
      ['review', 'mr:1', 'notdue', 'why mr:1']
    ])
  })

  it('a newer real tick that no longer lists the worktree drops it', () => {
    const { store } = setup()
    tick(store, 'fix-ci', [decision('mr:1', 'skipped', '/wt/a')])
    tick(store, 'fix-ci', [decision('mr:2', 'skipped', '/wt/b')])
    expect(store.timeline.nextFor('/wt/a')).toEqual([])
  })

  it("stores each decision's worktree path, and none for an item without one", () => {
    const { store, raw } = setup()
    tick(store, 'pull-dev', [
      decision('repo:web-platform', 'started', null),
      decision('mr:1', 'started', '/wt/a')
    ])
    expect(
      raw.prepare('SELECT item_key, worktree_path FROM tick_items ORDER BY rowid').all()
    ).toEqual([
      { item_key: 'repo:web-platform', worktree_path: null },
      { item_key: 'mr:1', worktree_path: '/wt/a' }
    ])
  })

  it.each([
    ['written with a trailing slash, read without', '/wt/a/', '/wt/a'],
    ['written plain, read with a trailing slash', '/wt/a', '/wt/a/'],
    ['written with doubled slashes, read with dot segments', '/wt//a', '/wt/./a/']
  ])('one worktree under any spelling of its path: %s', (_name, written, read) => {
    const { store, raw } = setup()
    tick(store, 'fix-ci', [decision('mr:1', 'skipped', written)])
    expect(store.timeline.nextFor(read).map((n) => n.itemKey)).toEqual(['mr:1'])
    expect(raw.prepare('SELECT worktree_path AS p FROM tick_items').get()).toEqual({ p: '/wt/a' })
  })
})

describe('TimelineStore inbox reads', () => {
  it("lists a worktree's open items, for one person or everyone", () => {
    const { store, raw } = setup()
    inbox(raw, 'i1', { person: 'nish' })
    inbox(raw, 'i2', { person: 'shivan' })
    inbox(raw, 'i3', { status: 'answered' })
    inbox(raw, 'i4', { path: '/wt/b' })
    expect(store.timeline.openInbox('/wt/a', null).map((i) => i.id)).toEqual(['i1', 'i2'])
    expect(store.timeline.openInbox('/wt/a', 'nish')).toEqual([
      {
        id: 'i1',
        automationId: 'fix-ci',
        runId: null,
        stepIdx: 0,
        itemKey: 'mr:1',
        worktreePath: '/wt/a',
        person: 'nish',
        type: 'question',
        title: 'Title i1',
        context: 'ctx',
        status: 'open',
        createdAt: 1
      }
    ])
  })

  it('lists open items under any spelling of the worktree path', () => {
    const { store, raw } = setup()
    inbox(raw, 'i1', { path: '/wt/a/' })
    inbox(raw, 'i2', { path: '/wt/a' })
    inbox(raw, 'i3', { path: '/wt/b' })
    expect(store.timeline.openInbox('/wt/a', null).map((i) => i.id)).toEqual(['i1', 'i2'])
    expect(store.timeline.openInbox('/wt/a/', null).map((i) => i.id)).toEqual(['i1', 'i2'])
  })

  it('lists the open and answered items of the given runs', () => {
    const { store, raw } = setup()
    store.runs.create({
      id: 'r1',
      automationId: 'fix-ci',
      tickId: null,
      itemKey: 'mr:1',
      itemLabel: '!1',
      worktreePath: '/wt/a',
      startedAt: 1
    })
    inbox(raw, 'i1', { run: 'r1' })
    inbox(raw, 'i2', { run: 'r1', status: 'answered' })
    inbox(raw, 'i3', { run: 'r1', status: 'obsolete' })
    expect(store.timeline.inboxForRuns(['r1']).map((i) => i.id)).toEqual(['i1', 'i2'])
    expect(store.timeline.inboxForRuns([])).toEqual([])
  })
})
