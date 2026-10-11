import { describe, expect, it } from 'vitest'
import { renderShellCommand } from './shell-template'

describe('renderShellCommand', () => {
  it.each([
    [
      'quotes a value with spaces',
      './teardown.sh {worktree.path}',
      { 'worktree.path': '/a b' },
      "./teardown.sh '/a b'"
    ],
    [
      'never runs $(…) or breaks on a quote in a value',
      'echo {mr.title}',
      { 'mr.title': "it's $(rm -rf ~)" },
      "echo 'it'\\''s $(rm -rf ~)'"
    ],
    [
      'escapes a value the author already put in single quotes',
      "close '{session.reason}'",
      { 'session.reason': "don't" },
      "close 'don'\\''t'"
    ],
    [
      'escapes a value inside single quotes with other text',
      "say 'pre {x} post'",
      { x: "y'z" },
      "say 'pre y'\\''z post'"
    ],
    [
      'escapes a value inside double quotes',
      'say "{mr.title}"',
      { 'mr.title': 'a "b" $c `d` \\e' },
      'say "a \\"b\\" \\$c \\`d\\` \\\\e"'
    ],
    [
      'quotes numbers and booleans too',
      'fix.sh {mr.iid} {mr.draft}',
      { 'mr.iid': 12, 'mr.draft': false },
      "fix.sh '12' 'false'"
    ],
    [
      'leaves a command without placeholders as written',
      'git -C "$HOME/x" pull --ff-only',
      {},
      'git -C "$HOME/x" pull --ff-only'
    ]
  ])('%s', (_name, template, fields, command) => {
    expect(renderShellCommand(template, fields)).toEqual({ ok: true, command })
  })

  it('fails when a placeholder has no value, naming every one', () => {
    expect(
      renderShellCommand('x.sh {worktree.path} {mr.iid} {worktree.path}', { 'mr.iid': null })
    ).toEqual({
      ok: false,
      missing: ['worktree.path', 'mr.iid']
    })
  })
})
