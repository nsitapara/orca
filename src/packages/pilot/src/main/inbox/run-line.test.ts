import { describe, expect, it } from 'vitest'
import { actionRunLine, RUN_LINE_MAX } from './run-line'

const PUSH_USAGE = 'push { "argv": [<worktree path>, <branch>, <commit>, <origin commit>] }'

describe('actionRunLine', () => {
  it.each<[string, string, Record<string, unknown>, string | null, string]>([
    [
      "names an act.py entry's argv by its usage",
      'push',
      { argv: ['/wt/web-1493', 'web-1493-a', 'abc123', 'def456'] },
      PUSH_USAGE,
      'push · worktree path /wt/web-1493 · branch web-1493-a · commit abc123 · origin commit def456'
    ],
    [
      'quotes an argv word a shell would split',
      'mark_ready',
      { argv: ['1588', "it's here"] },
      'mark_ready { "argv": [<iid>, <head sha>] }',
      "mark_ready · iid 1588 · head sha 'it'\\''s here'"
    ],
    [
      'keeps argv past the named ones as written',
      'post_review',
      { argv: ['1588', '/r.md', 'f00', '--except', 'a,b'] },
      'post_review { "argv": [<iid>, <review file>, <sha256>] }',
      'post_review · iid 1588 · review file /r.md · sha256 f00 --except a,b'
    ],
    [
      'shows the argv bare for an action the catalog lacks',
      'deploy',
      { argv: ['a', 'b c'] },
      null,
      "deploy a 'b c'"
    ],
    [
      'shows other args as compact JSON on one line',
      'linear_comment',
      { issue: 'WEB-1', body: 'line one\nline   two' },
      'linear_comment { "issue", "body", "workspace_id"?, "write_id"? }',
      'linear_comment {"issue":"WEB-1","body":"line one\\nline   two"}'
    ]
  ])('%s', (_name, action, args, usage, expected) => {
    expect(actionRunLine(action, args, usage)).toBe(expected)
  })

  it('caps a long line, ending it with …', () => {
    const line = actionRunLine('linear_comment', { body: 'x'.repeat(5000) }, null)
    expect(line).toHaveLength(RUN_LINE_MAX)
    expect(line.endsWith('…')).toBe(true)
    expect(line).not.toContain('\n')
  })
})
