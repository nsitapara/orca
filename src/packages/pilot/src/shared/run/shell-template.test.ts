import { execFileSync } from 'node:child_process'
import { existsSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { renderShellCommand, singleQuotedPlaceholders } from './shell-template'

describe('renderShellCommand', () => {
  it.each([
    [
      'references a value outside quotes as one argument',
      './teardown.sh {worktree.path}',
      { 'worktree.path': '/a b' },
      './teardown.sh "${PILOT_ARG_0}"',
      { PILOT_ARG_0: '/a b' }
    ],
    [
      'references a value inside double quotes without adding quotes',
      'say "pre {x} post"',
      { x: 'y"z' },
      'say "pre ${PILOT_ARG_0} post"',
      { PILOT_ARG_0: 'y"z' }
    ],
    [
      'gives numbers and booleans as text, one slot per distinct value',
      'fix.sh {mr.iid} {mr.draft} {mr.iid}',
      { 'mr.iid': 12, 'mr.draft': false },
      'fix.sh "${PILOT_ARG_0}" "${PILOT_ARG_1}" "${PILOT_ARG_0}"',
      { PILOT_ARG_0: '12', PILOT_ARG_1: 'false' }
    ],
    [
      'leaves ${HOME}, \\{ and a command without placeholders as written',
      'git -C "${HOME}/x" pull; echo \\{x} ${x}',
      {},
      'git -C "${HOME}/x" pull; echo \\{x} ${x}',
      {}
    ]
  ])('%s', (_name, template, fields, command, env) => {
    expect(renderShellCommand(template, fields)).toEqual({ ok: true, command, env })
  })

  it('fails when a placeholder has no value, naming every one', () => {
    expect(
      renderShellCommand('x.sh {worktree.path} {mr.iid} {worktree.path}', { 'mr.iid': null })
    ).toEqual({ ok: false, missing: ['worktree.path', 'mr.iid'], inSingleQuotes: [] })
  })

  it('refuses a placeholder inside single quotes', () => {
    expect(renderShellCommand("echo '{x}' {y}", { x: 'a', y: 'b' })).toEqual({
      ok: false,
      missing: [],
      inSingleQuotes: ['x']
    })
    expect(singleQuotedPlaceholders("sh -c 'echo {x}' && echo {y}")).toEqual(['x'])
  })
})

// The values here are what an MR title or branch name can hold. Whatever the template around the
// placeholder is, running the rendered command must not run the value.
describe('renderShellCommand never runs a value (real /bin/sh)', () => {
  const PAYLOADS = [
    '$(touch MARK)',
    '`touch MARK`',
    '"; touch MARK; "',
    "'; touch MARK; '",
    '\ntouch MARK\n',
    "$'\\'' ; touch MARK; #"
  ]
  // 'runs': the command is rendered and run; 'refused': the render fails (nothing runs).
  const CONTEXTS = [
    ['a bare argument', 'echo {x}', 'runs'],
    ['double quotes', 'echo "{x}"', 'runs'],
    ['a comment with a double quote', '# say "{x}\necho ok', 'runs'],
    ['a comment with an apostrophe', "# don't {x}\necho ok", 'refused'],
    ['an unquoted heredoc', 'cat <<EOF\n{x}\nEOF', 'runs'],
    ['a quoted heredoc', "cat <<'EOF'\n{x}\nEOF", 'runs'],
    ['a command substitution in quotes', 'echo "$(echo {x})"', 'runs'],
    ['quotes in a command substitution', 'echo $(echo "{x}")', 'runs'],
    ['single quotes in a command substitution', 'echo "$(printf %s \'{x}\')"', 'runs'],
    ['backticks in double quotes', 'echo "`echo {x}`"', 'runs'],
    ['a backslash before the placeholder', 'echo \\{x}', 'runs'],
    ['a backslash in double quotes', 'echo "\\{x}"', 'runs'],
    ['bash ANSI quoting before it', "echo $'a\\'b' {x}", 'refused'],
    ['a nested sh -c', "sh -c 'echo {x}'", 'refused']
  ] as const

  it.each(
    CONTEXTS.flatMap(([name, template, mode]) =>
      PAYLOADS.map((p) => [name, template, mode, p] as const)
    )
  )('%s, value %j', (_name, template, mode, payload) => {
    const dir = mkdtempSync(join(tmpdir(), 'pilot-tpl-'))
    const rendered = renderShellCommand(template, { x: payload })
    if (mode === 'refused') {
      expect(rendered.ok).toBe(false)
      return
    }
    if (!rendered.ok) {
      throw new Error('expected the template to render')
    }
    try {
      execFileSync('/bin/sh', ['-c', rendered.command], {
        cwd: dir,
        env: { PATH: '/usr/bin:/bin', ...rendered.env },
        stdio: 'pipe'
      })
    } catch {}
    expect(existsSync(join(dir, 'MARK'))).toBe(false)
  })

  it('hands the value over intact', () => {
    const rendered = renderShellCommand('printf %s "{x}"', { x: 'it\'s $(rm -rf ~) "q"' })
    if (!rendered.ok) {
      throw new Error('expected the template to render')
    }
    const out = execFileSync('/bin/sh', ['-c', rendered.command], {
      env: { PATH: '/usr/bin:/bin', ...rendered.env },
      encoding: 'utf8'
    })
    expect(out).toBe('it\'s $(rm -rf ~) "q"')
  })

  it('leaves ${HOME} for the shell', () => {
    const rendered = renderShellCommand('echo "${HOME}"', {})
    if (!rendered.ok) {
      throw new Error('expected the template to render')
    }
    const out = execFileSync('/bin/sh', ['-c', rendered.command], {
      env: { PATH: '/usr/bin:/bin', HOME: '/h' },
      encoding: 'utf8'
    })
    expect(out).toBe('/h\n')
  })
})
