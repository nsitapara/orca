import { cpSync, mkdtempSync, readFileSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { loadDefinitions } from '../../src/main/definitions/loader'
import { decideStep } from '../../src/shared/run/step-plan'
import { loadPortedAutomation, portedAutomationsDir } from './ported'

const SKILL = join(homedir(), '.agents', 'skills', 'review-cycles')
const { definition } = loadPortedAutomation('review-branch-code')
const HOUR = 3_600_000
const SCRIPT = 'python3 /Users/nishsitapara/.agents/skills/review-cycles/loop.py'
// No permission flag: Pilot's Codex command carries Settings' (agentDefaultArgs), and Codex refuses it twice.
const CODEX_ARGS = ['-c', 'check_for_update_on_startup=false']

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

// Old: Orca automation 129cdf72 "03 · Review and fix branch code", rrule "20 * * * *" in America/Los_Angeles, a 720-minute
// missed-run grace, precheck `loop.py sweep --push` (--max 2 by default), whose rounds handed off to each other's tabs.
describe('03 · Review and fix branch code: the definition (old job: orca automation 129cdf72, precheck loop.py sweep --push)', () => {
  it("keeps the sweep's schedule, two cycles per tick, its first-sight baseline and its retry of an abandoned cycle", () => {
    expect(definition).toMatchObject({
      name: '03 · Review and fix branch code',
      schedule: '20 * * * *',
      timezone: 'America/Los_Angeles',
      enabled: false,
      missedRunGraceMs: 12 * HOUR,
      firstSeen: 'baseline',
      oncePer: '{worktree.at_head}',
      retryAfterFailureMs: 50 * 60_000,
      limits: { perTick: 2, atOnce: null, timeoutMs: 2 * HOUR, order: 'listed' },
      workspace: { kind: 'item_worktree' },
      powers: ['commit', 'push'],
      inbox: 'nish'
    })
    expect(readFileSync(join(SKILL, 'loop.py'), 'utf8')).toContain(
      's.add_argument("--max", type=int, default=2'
    )
  })

  it('lists my worktrees with new own commits, and checks them in gate.evaluate’s order, then both agents’ quota', () => {
    expect(definition.items).toMatchObject({
      kind: 'worktree',
      where: {
        branch_owner: { people: ['nish'] },
        commits: { ignore_trailer: 'Agent-Loop: standards', first_sight: 'baseline' }
      }
    })
    // The worktree kind doesn't leave out a merged or closed MR's branch itself, so not_merged stays a check.
    expect(definition.checks).toEqual([
      { kind: 'worktree_clean' },
      { kind: 'mr', rule: 'not_merged' },
      { kind: 'mr', rule: 'not_approved' },
      { kind: 'quota', agent: 'claude', weekly: 90, session: 95 },
      { kind: 'quota', agent: 'codex', weekly: 90, session: 95 }
    ])
  })

  it('runs begin, the six round steps, complete, publish and a failure flag, each round in its agent’s worktree session', () => {
    expect(definition.steps.map((s) => [s.name, s.agent, s.mode, s.always])).toEqual([
      ['begin', 'shell', null, false],
      ['r1_claude', 'claude', 'pass', false],
      ['r1_codex', 'codex', 'pass', false],
      ['r2_codex', 'codex', 'review', false],
      ['r2_claude', 'claude', 'review', false],
      ['r3_claude', 'claude', 'review', false],
      ['r3_codex', 'codex', 'review', false],
      ['complete', 'shell', null, false],
      ['publish', 'shell', null, false],
      ['flag_failed', 'shell', null, true]
    ])
    for (const s of definition.steps.filter((x) => /^r\d_/.test(x.name))) {
      expect([s.name, s.skill, s.session, s.promptStyle]).toEqual([
        s.name,
        'review-cycles',
        { kind: 'per_worktree' },
        'wrapped'
      ])
      // One process per agent session: every Codex round launches with the same args, so a later round can reuse it.
      expect(s.args).toEqual(s.agent === 'codex' ? CODEX_ARGS : [])
    }
  })

  it('passes values to shell steps only through env, and the cycle’s head is the once_per head', () => {
    expect(step('begin')).toMatchObject({
      env: { REVIEW_BASE: '{worktree.marker}', AT_HEAD: '{worktree.at_head}' },
      run: `${SCRIPT} begin --base "$REVIEW_BASE" --head "\${AT_HEAD##*@}" --push`,
      timeoutMs: 2 * 60_000
    })
    expect(step('complete')).toMatchObject({ run: `${SCRIPT} complete`, env: {} })
    expect(step('publish')).toMatchObject({
      run: `${SCRIPT} publish`,
      exitCodes: { ok: [0], skip: [3] },
      timeoutMs: 30 * 60_000
    })
    for (const s of definition.steps.filter((x) => x.agent === 'shell')) {
      expect(s.run).not.toMatch(/\{[a-z_]+\.[a-z_.]+\}/)
    }
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

  // The sweep flagged a cycle that failed to start. One a review block stopped (an approved MR) stayed unflagged, and the
  // next sweep flagged an abandoned one as it restarted it (begin does that here), so neither is flagged twice.
  it('flags the worktree only when the cycle failed to start, and a flag that fails never fails the run', () => {
    const flag = step('flag_failed')
    expect(flag).toMatchObject({
      when: "{run.failed} == true and {steps.begin.status} != 'done'",
      env: { WT: '{worktree.path}', RUN: '{run.id}' }
    })
    expect(flag.run).toContain('orca worktree set --worktree "path:$WT" --unread')
    expect(flag.run).toContain('|| echo')
    const ended = (begin: 'done' | 'failed' | 'timed_out') => [
      { name: 'begin', status: begin, always: false, error: null },
      {
        name: 'complete',
        status: begin === 'done' ? ('failed' as const) : ('skipped' as const),
        always: false,
        error: null
      }
    ]
    const cases: [string, ReturnType<typeof ended>, boolean, boolean][] = [
      ['begin failed', ended('failed'), true, true],
      ['begin timed out', ended('timed_out'), true, true],
      ['a round never handed off, or a review block stopped the cycle', ended('done'), true, false],
      ['the cycle completed', ended('done').slice(0, 1), false, false]
    ]
    for (const [, steps, failed, flagged] of cases) {
      const fields = { 'run.failed': failed, 'steps.begin.status': steps[0].status }
      expect(decideStep(flag, steps, fields).run).toBe(flagged)
    }
  })

  it("sends my answers back to the asking round's session, else to the skill's answers mode", () => {
    expect(definition.answers).toEqual({
      resume: 'asking_session',
      else: { agent: 'claude', skill: 'review-cycles', mode: 'answers' }
    })
    expect(modeOutputs('pass')).toEqual(['changed', 'blocked'])
    expect(modeOutputs('review')).toEqual(['changed', 'blocked'])
    expect(modeOutputs('answers')).toEqual(['outcome', 'item_status', 'reply'])
    const answers = '~/.agents/skills/review-cycles/modes/answers.md'
    for (const file of ['SKILL.md', join('modes', 'pass.md'), join('modes', 'review.md')]) {
      expect(readFileSync(join(SKILL, file), 'utf8')).toContain(answers)
    }
    expect(readFileSync(join(SKILL, 'modes', 'answers.md'), 'utf8')).toContain('never `git push`')
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
