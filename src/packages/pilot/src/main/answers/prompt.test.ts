import { describe, expect, it } from 'vitest'
import type { InboxItemRow } from '../../shared/api-types'
import { answersLine, answersText, newSessionPrompt, withModePointer } from './prompt'

const item = (id: string, title: string, text: string) =>
  ({
    id,
    title,
    answer: { option: null, text, digest: 'd', via: 'page', callerKind: 'desktop' }
  }) as InboxItemRow

describe('answersLine', () => {
  it('lists each claimed answer on one line, with what to do and how to record it', () => {
    const line = answersLine('ci-1', 'ci-2-answer-7', [
      { item: item('in_a', 'Which image?', 'e2e'), revise: false, needsAgent: null },
      { item: item('in_b', 'Push?', 'revise: only the fix'), revise: true, needsAgent: null },
      {
        item: item('in_c', 'Mark ready?', 'approve'),
        revise: false,
        needsAgent: 'two pipelines disagree'
      }
    ])
    expect(line).not.toContain('\n')
    expect(line.split(' · ')).toEqual([
      'Answers to the questions run ci-1 asked (answer run ci-2-answer-7), already claimed:',
      '[in_a] "Which image?" → e2e',
      '[in_b] "Push?" → revise: only the fix (revise: change the proposal and ask again as a new action; don\'t run it)',
      '[in_c] "Mark ready?" → approve (approved; its action stopped for judgement: two pipelines disagree)',
      'Act on each one in this worktree, then record it with `pilot inbox tick --id <id> --outcome "<what happened>"`; if an answer is unclear, ask with `pilot inbox reply --id <id> --text "<question>"` and leave it open. Never wait in this tab for a reply.'
    ])
  })

  it("keeps an action's judgement note to one line", () => {
    const line = answersLine('ci-1', 'ci-2-answer-7', [
      {
        item: item('in_c', 'Mark ready?', 'approve'),
        revise: false,
        needsAgent: 'two\n  pipelines\ndisagree'
      }
    ])
    expect(line).not.toContain('\n')
    expect(line).toContain('(approved; its action stopped for judgement: two pipelines disagree)')
  })

  it('names Waiting on you when no run asked', () => {
    const line = answersLine(null, 'ci-2-answer-7', [
      { item: item('in_a', 'Which image?', 'e2e'), revise: false, needsAgent: null }
    ])
    expect(line.split(' · ')[0]).toBe(
      'Answers saved on Waiting on you (answer run ci-2-answer-7), already claimed:'
    )
  })
})

describe('answersText', () => {
  it('is the answers, one per line', () => {
    expect(
      answersText([
        { item: item('in_a', 'Which image?', 'e2e'), revise: false, needsAgent: null },
        { item: item('in_b', 'Push?', 'approve'), revise: false, needsAgent: null }
      ])
    ).toBe('e2e\napprove')
  })
})

describe('newSessionPrompt', () => {
  it('names the automation, the answer run, the skill and its answers mode', () => {
    const def = { name: 'Fix failed CI on my MRs' } as never
    expect(
      newSessionPrompt(
        def,
        { id: 'ci-2-answer-7', label: '!1561 web-1493' },
        { skill: 'fix-gitlab-ci', mode: 'answers' },
        'LINE'
      )
    ).toBe(
      [
        'Started by the Pilot automation "Fix failed CI on my MRs" (run ci-2-answer-7) for !1561 web-1493.',
        'Use the fix-gitlab-ci skill in its answers mode (~/.agents/skills/fix-gitlab-ci/modes/answers.md).',
        '',
        'LINE'
      ].join('\n')
    )
  })
})

describe('withModePointer', () => {
  it('points a resumed or forked session at the answers mode file, and leaves a skill-less line alone', () => {
    expect(withModePointer({ skill: 'fix-gitlab-ci', mode: 'answers' }, 'LINE')).toBe(
      'Apply these answers as ~/.agents/skills/fix-gitlab-ci/modes/answers.md says. LINE'
    )
    expect(withModePointer({ skill: null, mode: 'answers' }, 'LINE')).toBe('LINE')
  })
})
