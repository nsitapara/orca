import { cpSync, mkdtempSync, readFileSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import type { ItemFields } from '../../src/shared/api-types'
import { loadDefinitions } from '../../src/main/definitions/loader'
import { decideStep, type EndedStep } from '../../src/shared/run/step-plan'
import { loadPortedAutomation, portedAutomationsDir } from './ported'

const SKILL = join(homedir(), '.agents', 'skills', 'review-cycles')
const { definition } = loadPortedAutomation('review-branch-code')
const HOUR = 3_600_000
const MINUTE = 60_000

function modeOutputs(mode: string): string[] {
  const text = readFileSync(join(SKILL, 'modes', `${mode}.md`), 'utf8')
  const front = /^---\n([\s\S]*?)\n---\n/.exec(text)?.[1] ?? ''
  const list = /^outputs: \[(.*)\]$/m.exec(front)?.[1] ?? ''
  return list
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
}

function step(name: string) {
  const found = definition.steps.find((s) => s.name === name)
  if (!found) {
    throw new Error(`no step ${name}`)
  }
  return found
}

// Whether a step runs after the steps before it ended so, with these fields (the engine's own rule, decideStep).
function runs(name: string, ended: EndedStep[], fields: ItemFields): boolean {
  return decideStep(step(name), ended, fields).run
}

const ok = (name: string): EndedStep => ({ name, status: 'done', always: false, error: null })
const broke = (name: string): EndedStep => ({ name, status: 'failed', always: false, error: null })

// Old: Orca automation 129cdf72 "03 · Review and fix branch code", rrule "20 * * * *" in America/Los_Angeles, a 720-minute
// missed-run grace, precheck `loop.py sweep --push` (--max 2). Since pilotCLI milestone 8 (spec §7.5) one orchestrating
// agent runs the review (/orchestrate review-cycles) between pilotcli's context and its guarded publish.
describe('03 · Review and fix branch code: the definition (old job: orca automation 129cdf72, precheck loop.py sweep --push)', () => {
  it("keeps the sweep's schedule, two reviews per tick, its first-sight baseline and its retry of an abandoned review", () => {
    expect(definition).toMatchObject({
      name: '03 · Review and fix branch code',
      schedule: '20 * * * *',
      timezone: 'America/Los_Angeles',
      missedRunGraceMs: 12 * HOUR,
      firstSeen: 'baseline',
      oncePer: '{worktree.at_head}',
      retryAfterFailureMs: 50 * MINUTE,
      // 3 phases × 45 minutes plus the publish's hooks (spec §7.5: at least 3h).
      limits: { perTick: 2, atOnce: null, timeoutMs: 3 * HOUR, order: 'listed' },
      workspace: { kind: 'item_worktree' },
      powers: ['commit', 'push'],
      inbox: 'nish'
    })
  })

  it('lists my worktrees with new own commits, and checks them in gate.evaluate’s order, then Codex’s quota', () => {
    expect(definition.items).toMatchObject({
      kind: 'worktree',
      where: {
        branch_owner: { people: ['nish'] },
        commits: { ignore_trailer: 'Agent-Loop: standards', first_sight: 'baseline' }
      }
    })
    // The worktree kind doesn't leave out a merged or closed MR's branch itself, so not_merged stays a check. The runner
    // holds on Claude's quota (the review step's agent); Codex's stays a check, as the runner can't see the Codex
    // sessions the orchestrator starts.
    expect(definition.checks).toEqual([
      { kind: 'worktree_clean' },
      { kind: 'mr', rule: 'not_merged' },
      { kind: 'mr', rule: 'not_approved' },
      { kind: 'quota', agent: 'codex', weekly: 90, session: 95 }
    ])
  })

  it("runs pilotcli's context, one orchestrating review, pilotcli's guarded publish, then the two flags", () => {
    expect(definition.steps.map((s) => [s.name, s.agent, s.always])).toEqual([
      ['context', 'shell', false],
      ['review', 'claude', false],
      ['publish', 'shell', false],
      ['flag_dirty', 'shell', true],
      ['flag_failed', 'shell', true]
    ])
    // A shell step gets no item on stdin (only a check does), so the item's fields come as env.
    expect(step('context')).toMatchObject({
      run: 'pilotcli skills get-context review-cycles "$DIR" --base "${MARKER##*@}" --head "${AT_HEAD##*@}"',
      env: { DIR: '{worktree.path}', MARKER: '{worktree.marker}', AT_HEAD: '{worktree.at_head}' },
      exitCodes: { ok: [0], stop: [3] },
      timeoutMs: 2 * MINUTE
    })
  })

  // Spec §7.5: the rounds run inside one agent step, Claude, Codex, and Claude again when Codex changed code; its review
  // step outlasts 3 phases × 45 minutes.
  it('reviews in one /orchestrate review-cycles step, from the context step’s facts, with the outputs publish reads', () => {
    expect(step('review')).toMatchObject({
      agent: 'claude',
      skill: 'orchestrate',
      promptStyle: 'raw',
      prompt:
        '/orchestrate review-cycles base={steps.context.base} head={steps.context.head} remote={steps.context.remote} branch={steps.context.branch} mr={steps.context.mr}',
      outputs: ['verdict', 'head', 'summary', 'rounds', 'open', 'dirty'],
      timeoutMs: 175 * MINUTE
    })
  })

  // pilot_mode.py's publication checks, now pilotcli's (spec §7.5): a refused push is a skip, never a failed run.
  it('publishes only a reviewed head, through push-branch’s guards, from env', () => {
    expect(step('publish')).toMatchObject({
      when: "{steps.review.verdict} == 'ok' and {steps.context.remote} != null",
      env: {
        BRANCH: '{steps.context.branch}',
        REMOTE: '{steps.context.remote}',
        HEAD_SHA: '{steps.review.head}',
        BASE: '{steps.context.base}',
        REVIEWED: '{steps.context.head}'
      },
      run: 'pilotcli git push-branch "$BRANCH" unapproved=true --checkout . --expect-sha "$REMOTE" --expect-head "$HEAD_SHA" --from "$BASE" --reviewed "$REVIEWED" --trailer "Agent-Loop: standards"',
      exitCodes: { ok: [0], skip: [1, 2, 3, 5] },
      timeoutMs: 30 * MINUTE
    })
    const reviewed = [ok('context'), ok('review')]
    const at = (verdict: string, remote: string | null) => ({
      'steps.review.verdict': verdict,
      'steps.context.remote': remote
    })
    expect(runs('publish', reviewed, at('ok', 'a'.repeat(40)))).toBe(true)
    expect(runs('publish', reviewed, at('ok', null))).toBe(false) // a branch not on origin
    expect(runs('publish', reviewed, at('blocked', 'a'.repeat(40)))).toBe(false)
    expect(runs('publish', [ok('context'), broke('review')], at('ok', 'a'.repeat(40)))).toBe(false)
    for (const s of definition.steps.filter((x) => x.agent === 'shell')) {
      expect(s.run).not.toMatch(/\{[a-z_]+\.[a-z_.]+\}/)
    }
  })

  // Spec §7.5's constraints: a failed phase's uncommitted changes flag the worktree, so the jobs that need a clean tree
  // don't skip it silently; any failed run flags it. A flag that fails never fails the run.
  it('flags the worktree when the review left it dirty or the run failed', () => {
    for (const name of ['flag_dirty', 'flag_failed']) {
      expect(step(name).env).toEqual({ WT: '{worktree.path}', RUN: '{run.id}' })
      expect(step(name).run).toContain('orca worktree set --worktree "path:$WT" --unread')
      expect(step(name).run).toContain('|| echo')
    }
    expect(step('flag_dirty').when).toBe("{steps.review.dirty} == 'yes'")
    expect(step('flag_failed').when).toBe('{run.failed} == true')
    const failed = [ok('context'), broke('review')]
    expect(runs('flag_dirty', failed, { 'steps.review.dirty': 'yes', 'run.failed': true })).toBe(
      true
    )
    expect(runs('flag_dirty', failed, { 'steps.review.dirty': null, 'run.failed': true })).toBe(
      false
    )
    expect(runs('flag_failed', failed, { 'run.failed': true })).toBe(true)
    expect(runs('flag_failed', [ok('context'), ok('review')], { 'run.failed': false })).toBe(false)
  })

  it('leaves evidence preparation to an independent item queue with no publication powers', () => {
    const preparation = loadPortedAutomation('prepare-inbox-item-context').definition
    expect(definition.steps.some((s) => s.skill === 'item-details')).toBe(false)
    expect(preparation.items).toMatchObject({ kind: 'inbox_preparation' })
    expect(preparation.oncePer).toBe(
      '{preparation.item_id}:{preparation.revision}:{preparation.attempt}'
    )
    expect(preparation.powers).toEqual([])
    expect(preparation.steps).toHaveLength(1)
    expect(preparation.steps[0]).toMatchObject({
      name: 'prepare',
      agent: 'claude',
      skill: 'prepare-inbox-item-context',
      mode: 'worker'
    })
    expect(preparation.steps[0].prompt).toContain('{preparation.item_id}')
    expect(preparation.steps[0].prompt).toContain('{preparation.revision}')
    // Published through pilotcli's own command, which stamps the provenance; there is no prepare-complete command.
    expect(preparation.steps[0].prompt).toContain('update-preparation --complete')
    expect(preparation.steps[0].prompt).not.toContain('prepare-complete')
  })

  // The orchestrator's session holds no phase's context (spec §7.5), so an answer starts a fresh session in the skill's
  // answers mode, which pushes only through Pilot's push action.
  it("sends my answers to a fresh session in the skill's answers mode", () => {
    expect(definition.answers).toEqual({
      resume: 'never',
      else: { agent: 'claude', skill: 'review-cycles', mode: 'answers' }
    })
    expect(modeOutputs('answers')).toEqual(['outcome', 'item_status', 'reply'])
    expect(readFileSync(join(SKILL, 'modes', 'answers.md'), 'utf8')).toContain(
      'pilot action run --name=push'
    )
  })

  it('loads through the loader on a copy', () => {
    const copy = mkdtempSync(join(tmpdir(), 'parity-03-yaml-'))
    for (const file of ['review-branch-code.yaml', 'people.yaml']) {
      cpSync(join(portedAutomationsDir(), file), join(copy, file))
    }
    const loaded = loadDefinitions([copy])
    expect(loaded.errors).toEqual([])
    expect(loaded.definitions.map((d) => d.id)).toEqual(['review-branch-code'])
  })
})
