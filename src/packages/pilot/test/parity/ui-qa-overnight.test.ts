import { cpSync, existsSync, mkdtempSync, readFileSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { loadDefinitions } from '../../src/main/definitions/loader'
import { decideStep, type EndedStep } from '../../src/shared/run/step-plan'
import { loadPortedAutomation, portedAutomationsDir } from './ported'

const SKILL = join(homedir(), '.agents', 'skills', 'ui-qa')
const YAML = join(portedAutomationsDir(), 'ui-qa-overnight.yaml')
const HOUR = 3_600_000
const MINUTE = 60_000
const SCRIPT = 'python3 /Users/nishsitapara/.agents/skills/ui-qa/scripts/loop.py'
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

function load() {
  return loadPortedAutomation('ui-qa-overnight').definition
}

function step(name: string) {
  const found = load().steps.find((s) => s.name === name)
  if (!found) {
    throw new Error(`no step ${name}`)
  }
  return found
}

// Old: Orca automation 736981a0 "04 · Test branch UIs overnight", rrule "*/20 2-7 * * *" in America/Los_Angeles, a
// 20-minute missed-run grace, precheck `loop.py sweep` (600 s), which started one run at a time inside 02:00-05:59,
// the longest-waiting due worktree first, Codex in a tab with the stack in another, 60 minutes per session.
describe.skipIf(!existsSync(SKILL))(
  '04 · Test branch UIs overnight: the definition (old job: orca automation 736981a0, precheck loop.py sweep)',
  () => {
    it("keeps the sweep's schedule, one run at a time in the start window, and its 12-hour retry", () => {
      expect(load()).toMatchObject({
        name: '04 · Test branch UIs overnight',
        schedule: '*/20 2-7 * * *',
        timezone: 'America/Los_Angeles',
        enabled: false,
        missedRunGraceMs: 20 * MINUTE,
        firstSeen: 'baseline',
        oncePer: '{worktree.at_head}',
        retryAfterFailureMs: 12 * HOUR,
        limits: { perTick: 1, atOnce: 1, timeoutMs: HOUR, order: 'oldest_waiting_first' },
        workspace: { kind: 'item_worktree' },
        powers: ['commit', 'push'],
        inbox: 'nish'
      })
      const common = readFileSync(join(SKILL, 'scripts', 'common.py'), 'utf8')
      expect(common).toContain('START_HOURS = range(2, 6)')
      expect(common).toContain('CAP_MINUTES = 60')
      expect(common).toContain('RETRY_AFTER_HOURS = 12')
    })

    it('lists my worktrees with new own commits, testing a first sight with recent work, and checks them in due.decide’s order', () => {
      expect(load().items).toMatchObject({
        kind: 'worktree',
        where: { branch_owner: { people: ['nish'] }, commits: { first_sight: 'test_recent' } }
      })
      // The worktree kind doesn't leave out a merged or closed MR's branch itself, so not_merged stays a check.
      expect(load().checks).toEqual([
        {
          kind: 'field',
          expr: '{worktree.git_operation} == null',
          reason: 'A merge, rebase or git lock is in progress; retry next tick'
        },
        { kind: 'mr', rule: 'not_merged' },
        { kind: 'mr', rule: 'not_approved' },
        { kind: 'answers_none_pending' },
        { kind: 'worktree_idle' },
        { kind: 'window', start: '02:00', end: '05:59' },
        { kind: 'quota', agent: 'codex', weekly: 90, session: 95 }
      ])
    })

    it('runs the stack, the QA session, teardown and report whatever happened, then the verdict and the fixer', () => {
      expect(load().steps.map((s) => [s.name, s.agent, s.mode, s.always])).toEqual([
        ['stack', 'shell', null, false],
        ['test', 'codex', 'run', true],
        ['teardown', 'shell', null, true],
        ['report', 'shell', null, true],
        ['flag_failed', 'shell', null, true],
        ['verdict', 'shell', null, false],
        ['fix', 'claude', 'fix', true]
      ])
      expect(step('test')).toMatchObject({
        skill: 'ui-qa',
        args: CODEX_ARGS,
        when: "{steps.stack.status} == 'done'",
        timeoutMs: HOUR
      })
      // No --permission-mode: Pilot's Claude command already carries --dangerously-skip-permissions, which Claude
      // Code ranks above it, so an acceptEdits here never took effect.
      expect(step('fix')).toMatchObject({
        skill: 'ui-qa',
        args: [],
        when: "{steps.report.fix} == 'yes'",
        timeoutMs: 90 * MINUTE
      })
      expect(step('fix').prompt).toContain('{steps.report.handoff}')
    })

    it('lets the night finish while the independent preparation job prepares its code cards', () => {
      const preparation = loadPortedAutomation('prepare-inbox-item-context').definition
      expect(load().steps.some((s) => s.skill === 'item-details')).toBe(false)
      expect(preparation.items).toMatchObject({ kind: 'inbox_preparation' })
      expect(preparation.workspace).toEqual({ kind: 'item_worktree' })
      expect(preparation.steps).toHaveLength(1)
      expect(preparation.steps[0]).toMatchObject({
        skill: 'prepare-inbox-item-context',
        mode: 'worker',
        always: false
      })
      expect(preparation.powers).toEqual([])
    })

    it('passes values to shell steps only through env, and the stack tests the once_per head', () => {
      expect(step('stack')).toMatchObject({
        env: {
          AT_HEAD: '{worktree.at_head}',
          SINCE: '{worktree.since}',
          COMMITS: '{worktree.new_commits}',
          FIRST_SIGHT: '{worktree.first_sight}'
        },
        run: `${SCRIPT} stack-up --head "\${AT_HEAD##*@}" --since "$SINCE" --commits "$COMMITS" --first-sight "$FIRST_SIGHT"`,
        timeoutMs: 5 * MINUTE
      })
      expect(step('teardown')).toMatchObject({ run: `${SCRIPT} stack-down`, env: {} })
      expect(step('report')).toMatchObject({
        env: { STACK: '{steps.stack.status}', TEST: '{steps.test.status}' },
        run: `${SCRIPT} report --stack "$STACK" --test "$TEST"`
      })
      expect(step('verdict')).toMatchObject({ env: { TESTED: '{steps.report.tested}' } })
      for (const s of load().steps.filter((x) => x.agent === 'shell')) {
        expect(s.run).not.toMatch(/\{[a-z_]+\.[a-z_.]+\}/)
      }
    })

    // report flags the card on every ending, as close_out did; flag_failed only when report itself broke, so a card
    // is never flagged twice.
    it('flags the worktree only when the report step broke, and a flag that fails never fails the run', () => {
      const flag = step('flag_failed')
      expect(flag).toMatchObject({
        when: "{steps.report.status} != 'done'",
        env: { WT: '{worktree.path}', RUN: '{run.id}' }
      })
      expect(flag.run).toContain('orca worktree set --worktree "path:$WT" --unread')
      expect(flag.run).toContain('|| echo')
      const cases: [EndedStep['status'], boolean][] = [
        ['done', false],
        ['failed', true],
        ['timed_out', true]
      ]
      for (const [report, flagged] of cases) {
        const ended: EndedStep[] = [
          { name: 'stack', status: 'failed', always: false, error: null },
          { name: 'report', status: report, always: true, error: null }
        ]
        expect(decideStep(flag, ended, { 'steps.report.status': report }).run).toBe(flagged)
      }
    })

    it("sends my answers to the skill's answers mode; the modes name their outputs and read untrusted text as data", () => {
      expect(load().answers).toEqual({
        resume: 'asking_session',
        else: { agent: 'claude', skill: 'ui-qa', mode: 'answers' }
      })
      expect(modeOutputs('run')).toEqual(['outcome'])
      expect(modeOutputs('fix')).toEqual([])
      expect(modeOutputs('answers')).toEqual(['outcome', 'item_status', 'reply'])
      expect(readFileSync(join(SKILL, 'SKILL.md'), 'utf8')).toContain(
        '~/.agents/skills/ui-qa/modes/answers.md'
      )
      expect(readFileSync(join(SKILL, 'modes', 'answers.md'), 'utf8')).toContain('never `git push`')
      expect(readFileSync(join(SKILL, 'modes', 'fix.md'), 'utf8')).toContain('never push')
    })

    // In a Pilot run the report files each finding as a card in Pilot's inbox (Pilot never reads the note's items),
    // so the fixer closes the cards it fixed and files new questions there, never as `- [ ]` lines.
    it("has the fixer close the finding cards it fixed in Pilot's inbox, not the note's items", () => {
      const fix = readFileSync(join(SKILL, 'modes', 'fix.md'), 'utf8')
      expect(fix).toContain("the report's findings are cards in Pilot's inbox")
      expect(fix).toContain("pilot inbox tick --id <the handoff's cards[<finding id>]>")
      // Posted with pilotcli inbox create-card as plain cards (D1): no --evidence, and never through the intake.
      expect(fix).toContain('pilotcli inbox create-card --kind <default|flagged|question>')
      expect(fix).toContain('as a plain card')
      expect(fix).not.toContain('--evidence')
      expect(fix).not.toContain('context.py enqueue')
      expect(fix).toContain('write no `- [ ]` line')
    })

    it('loads through the loader on a copy', () => {
      const copy = mkdtempSync(join(tmpdir(), 'parity-04-yaml-'))
      for (const file of ['ui-qa-overnight.yaml', 'people.yaml']) {
        cpSync(join(portedAutomationsDir(), file), join(copy, file))
      }
      const loaded = loadDefinitions([copy])
      expect(loaded.errors).toEqual([])
      expect(loaded.definitions.map((d) => d.id)).toEqual(['ui-qa-overnight'])
      expect(existsSync(YAML)).toBe(true)
    })
  }
)
