import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { parseAutomationYaml } from '../../shared/definition/parse'
import { parsePeopleYaml } from '../../shared/people'
import { addInboxItem } from '../inbox/inbox-add'
import { PilotStore } from '../store/store'
import { VaultExporter } from './export'
import { jobFolderFor } from './job-folder'

const def = parseAutomationYaml(
  'name: Fix failed CI on my MRs\nrepo: r\nschedule: manual\nitems: { kind: merge_request }\nsteps: [ { agent: claude, prompt: x } ]\ninbox: nish\n',
  '/a/ci.yaml'
)
const people = parsePeopleYaml('people:\n  - { id: nish, name: Nish, gitlab: nish8 }\n')
if (!def.ok || !people.ok) {
  throw new Error('setup')
}
const DAY = 24 * 60 * 60_000

function setup() {
  const root = mkdtempSync(join(tmpdir(), 'pilot-vault-'))
  const dir = join(root, 'Agent Work', 'Automations')
  const folder = join(dir, '05 · Fix failed CI on my MRs')
  mkdirSync(folder, { recursive: true })
  const store = PilotStore.open(join(root, 'db.sqlite'))
  const tickId = store.startTick('ci', false, 1)
  store.recordDecisions(
    tickId,
    [
      {
        key: 'mr:1561',
        label: '!1561 web-1493',
        verdict: 'started',
        reason: '',
        checks: [],
        onceKey: 'k',
        fields: { 'mr.branch': 'web-1493-a' }
      }
    ],
    new Map([['mr:1561', 'run-1']])
  )
  store.runs.create({
    id: 'run-1',
    automationId: 'ci',
    tickId,
    itemKey: 'mr:1561',
    itemLabel: '!1561 web-1493',
    worktreePath: '/wt/1493',
    startedAt: 1
  })
  store.runs.createStep({
    runId: 'run-1',
    idx: 0,
    name: 'fix',
    agent: 'claude',
    skill: 'fix-gitlab-ci',
    startedAt: 1
  })
  let clock = new Date(2026, 9, 11, 9, 5).getTime()
  const exporter = new VaultExporter({
    store,
    now: () => clock,
    dir,
    definitions: () => [def.ok ? def.definition : (null as never)],
    log: () => {}
  })
  const inbox = {
    store,
    now: () => clock,
    definitions: () => [def.ok ? def.definition : (null as never)],
    people: () => (people.ok ? people.directory : (null as never))
  }
  return { store, folder, exporter, inbox, advance: (ms: number) => (clock += ms), at: () => clock }
}

describe('VaultExporter: Runs.md', () => {
  it("writes a finished run's summary once, newest first", () => {
    const { store, folder, exporter, at } = setup()
    writeFileSync(
      join(folder, 'Runs.md'),
      '---\ncreated: 2026-01-01T00:00\nupdated: 2026-01-01T00:00\n---\n# Runs\n\nNewest first, one line per run that did something. Job: [[x|05]].\n\n- 2026-10-10 10:00 · !1500 older\n'
    )
    store.runs.updateStep('run-1', 0, {
      status: 'done',
      outputs: { summary: '!1561 web-1493-a · fixed the flaky spec · pushed 9c1e2f0' }
    })
    store.runs.update('run-1', { status: 'done', finishedAt: at() })
    expect(exporter.pass().lines).toBe(1)
    expect(exporter.pass().lines).toBe(0)
    const runs = readFileSync(join(folder, 'Runs.md'), 'utf8')
    expect(runs).toContain('updated: 2026-10-11T09:05')
    expect(runs).toContain(
      '- 2026-10-11 09:05 · !1561 web-1493-a · fixed the flaky spec · pushed 9c1e2f0\n- 2026-10-10 10:00 · !1500 older\n'
    )
  })

  it('starts a new Runs.md with frontmatter and a header, and says how a run ended when it left no summary', () => {
    const { store, folder, exporter, at } = setup()
    store.runs.update('run-1', {
      status: 'failed',
      outcome: 'The terminal closed before the agent finished',
      finishedAt: at()
    })
    exporter.pass()
    const runs = readFileSync(join(folder, 'Runs.md'), 'utf8')
    expect(runs.startsWith('---\ncreated: 2026-10-11T09:05\n')).toBe(true)
    expect(runs).toContain('# Runs\n\nNewest first, one line per run that did something.')
    expect(runs).toContain(
      '- 2026-10-11 09:05 · !1561 web-1493 · failed: The terminal closed before the agent finished · run run-1\n'
    )
  })

  it.each([['running'], ['asking'], ['cancelled']])('writes nothing for a %s run', (status) => {
    const { store, folder, exporter, at } = setup()
    store.runs.update('run-1', { status: status as never, finishedAt: at() })
    exporter.pass()
    expect(existsSync(join(folder, 'Runs.md'))).toBe(false)
  })
})

describe('VaultExporter: branch notes', () => {
  it("keeps a read-only block of the branch's cards that vault.py can't parse as items", () => {
    const { folder, exporter, inbox } = setup()
    writeFileSync(join(folder, 'web-1493-a.md'), '# web-1493-a\nmy own notes\n')
    addInboxItem(inbox, {
      runId: 'run-1',
      type: 'action',
      title: "Push !1561's 2 commits to origin?",
      context: 'Fixed it.',
      options: ['Approve — push', 'Skip — keep them local'],
      action: 'push',
      actionArgs: { argv: ['/wt/1493', 'web-1493-a', 'aaa', 'bbb'] }
    })
    expect(exporter.pass().notes).toBe(1)
    const note = readFileSync(join(folder, 'web-1493-a.md'), 'utf8')
    expect(note).toContain('# web-1493-a\nmy own notes\n')
    expect(note).toContain(
      "- **action** · Push !1561's 2 commits to origin? — `web-1493-a` · waiting on you"
    )
    expect(note).not.toMatch(/^- \[[ xX]\]/m)
    expect(exporter.pass().notes).toBe(0)
  })

  it('removes the block a day after its last card closed', () => {
    const { store, folder, exporter, inbox, advance } = setup()
    const added = addInboxItem(inbox, {
      runId: 'run-1',
      type: 'question',
      title: 'Which image?',
      options: ['e2e', 'unit']
    })
    exporter.pass()
    store.inbox.update(added.id!, { status: 'done', outcome: 'done: e2e' }, inbox.now())
    exporter.pass()
    expect(readFileSync(join(folder, 'web-1493-a.md'), 'utf8')).toContain('✓ done: e2e')
    advance(DAY + 1)
    exporter.pass()
    expect(readFileSync(join(folder, 'web-1493-a.md'), 'utf8')).not.toContain('pilot:inbox')
  })

  it('puts a job-wide card in Items.md', () => {
    const { folder, exporter, inbox } = setup()
    addInboxItem(inbox, {
      automationId: 'ci',
      itemKey: 'repo:r',
      type: 'question',
      title: 'Rotate the token?',
      options: ['Yes', 'No']
    })
    exporter.pass()
    expect(readFileSync(join(folder, 'Items.md'), 'utf8')).toContain(
      '- **question** · Rotate the token? — `job` · waiting on you'
    )
  })
})

describe('jobFolderFor', () => {
  it.each([
    ['Fix failed CI on my MRs', '05 · Fix failed CI on my MRs'],
    ['05 · Fix failed CI on my MRs', '05 · Fix failed CI on my MRs'],
    ['Exact name', 'Exact name'],
    ['New one', 'New one']
  ])('%s → %s', (name, folder) => {
    const dir = mkdtempSync(join(tmpdir(), 'pilot-jobs-'))
    mkdirSync(join(dir, '05 · Fix failed CI on my MRs'))
    mkdirSync(join(dir, 'Exact name'))
    expect(jobFolderFor(dir, name)).toBe(join(dir, folder))
  })
})
