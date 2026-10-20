import { mkdirSync, mkdtempSync, utimesSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { findChildSessions, type ChildScope } from './child-sessions'

const at = (h: number, m = 0): number => new Date(2026, 9, 11, h, m).getTime()
const iso = (h: number, m = 0): string => new Date(at(h, m)).toISOString()
const pad = (n: number): string => String(n).padStart(2, '0')
const CWD = '/wt/run-1'
// The step ran 10:00–11:00 in CWD as session `step`; `other` is another step's session.
const scope: ChildScope = {
  cwd: CWD,
  sessionId: 'step',
  window: { from: at(10), to: at(11) },
  claimed: new Set(['step', 'other'])
}

function homes(): { claudeProjects: string; codexHome: string } {
  const root = mkdtempSync(join(tmpdir(), 'pilot-children-'))
  return { claudeProjects: join(root, 'projects'), codexHome: join(root, 'codex') }
}

function claudeSession(
  projects: string,
  id: string,
  head: { entrypoint: string; h: number; m?: number; cwd?: string }
): string {
  const dir = join(projects, '-wt-run-1')
  mkdirSync(dir, { recursive: true })
  const path = join(dir, `${id}.jsonl`)
  const lines = [
    { type: 'file-history-snapshot' },
    {
      type: 'user',
      sessionId: id,
      entrypoint: head.entrypoint,
      cwd: head.cwd ?? CWD,
      timestamp: iso(head.h, head.m)
    }
  ]
  writeFileSync(path, `${lines.map((l) => JSON.stringify(l)).join('\n')}\n`)
  const written = new Date(at(head.h, (head.m ?? 0) + 1))
  utimesSync(path, written, written)
  return path
}

function rollout(
  home: string,
  id: string,
  h: number,
  m: number,
  meta: Record<string, unknown>
): string {
  const dir = join(home, 'sessions', '2026', '10', '11')
  mkdirSync(dir, { recursive: true })
  const path = join(dir, `rollout-2026-10-11T${pad(h)}-${pad(m)}-00-${id}.jsonl`)
  const line = { timestamp: iso(h, m), type: 'session_meta', payload: { id, ...meta } }
  writeFileSync(path, `${JSON.stringify(line)}\n`)
  return path
}

describe('findChildSessions', () => {
  it('counts the non-interactive Claude sessions that began in the run folder inside the window, with their subagents', async () => {
    const { claudeProjects, codexHome } = homes()
    const child = claudeSession(claudeProjects, 'phase-1', { entrypoint: 'sdk-cli', h: 10, m: 5 })
    const review = claudeSession(claudeProjects, 'review', { entrypoint: 'sdk-py', h: 10, m: 40 })
    const subagent = join(claudeProjects, '-wt-run-1', 'phase-1', 'subagents', 'agent-a.jsonl')
    mkdirSync(join(subagent, '..'), { recursive: true })
    writeFileSync(subagent, '')
    claudeSession(claudeProjects, 'typed', { entrypoint: 'cli', h: 10, m: 10 })
    claudeSession(claudeProjects, 'before', { entrypoint: 'sdk-cli', h: 9, m: 30 })
    claudeSession(claudeProjects, 'after', { entrypoint: 'sdk-cli', h: 11, m: 30 })
    claudeSession(claudeProjects, 'other', { entrypoint: 'sdk-cli', h: 10, m: 20 })
    claudeSession(claudeProjects, 'elsewhere', {
      entrypoint: 'sdk-cli',
      h: 10,
      m: 20,
      cwd: '/wt/run.1'
    })
    const found = await findChildSessions(scope, { claudeProjects, codexHomes: [codexHome] })
    expect(found.claude.map((p) => basename(p))).toEqual([
      basename(child),
      'agent-a.jsonl',
      basename(review)
    ])
    expect(found.codex).toEqual([])
  })

  it('counts codex exec children in the run folder and the subagents of the step or of a child', async () => {
    const { claudeProjects, codexHome } = homes()
    const exec = { originator: 'codex_exec', source: 'exec' }
    const spawned = (parent: string) => ({
      cwd: '/elsewhere',
      source: { subagent: { thread_spawn: { parent_thread_id: parent } } }
    })
    const check = rollout(codexHome, 'check', 10, 20, { ...exec, cwd: CWD })
    const ownSubagent = rollout(codexHome, 'sub-1', 10, 5, spawned('step'))
    const childSubagent = rollout(codexHome, 'sub-2', 10, 25, spawned('check'))
    rollout(codexHome, 'step', 10, 0, { originator: 'codex-tui', source: 'cli', cwd: CWD })
    rollout(codexHome, 'typed', 10, 30, { originator: 'codex-tui', source: 'cli', cwd: CWD })
    rollout(codexHome, 'far', 10, 30, { ...exec, cwd: '/wt/run-2' })
    rollout(codexHome, 'late', 11, 30, { ...exec, cwd: CWD })
    rollout(codexHome, 'other', 10, 40, { ...exec, cwd: CWD })
    rollout(codexHome, 'strangers', 10, 45, spawned('typed'))
    const found = await findChildSessions(scope, { claudeProjects, codexHomes: [codexHome] })
    expect(found.codex).toEqual([ownSubagent, check, childSubagent])
    expect(found.claude).toEqual([])
  })

  it('finds only Codex subagents when the run has no folder', async () => {
    const { claudeProjects, codexHome } = homes()
    claudeSession(claudeProjects, 'phase-1', { entrypoint: 'sdk-cli', h: 10, m: 5 })
    rollout(codexHome, 'check', 10, 20, { originator: 'codex_exec', cwd: CWD })
    const sub = rollout(codexHome, 'sub', 10, 5, { parent_thread_id: 'step', cwd: CWD })
    const found = await findChildSessions(
      { ...scope, cwd: null },
      { claudeProjects, codexHomes: [codexHome] }
    )
    expect(found).toEqual({ claude: [], codex: [sub] })
  })
})
