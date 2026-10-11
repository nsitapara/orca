import { execFileSync } from 'node:child_process'
import { existsSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { renderTemplate } from '../template'
import { renderShellCommand, shellProblemMessage, shellTemplateProblems } from './shell-template'

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
    ).toEqual({ ok: false, missing: ['worktree.path', 'mr.iid'], problems: [] })
  })

  it('refuses a placeholder inside single quotes, pointing to env:', () => {
    const rendered = renderShellCommand("echo '{x}' {y}", { x: 'a', y: 'b' })
    expect(rendered).toEqual({
      ok: false,
      missing: [],
      problems: [{ name: 'x', reason: 'it is inside single quotes' }]
    })
    expect(shellTemplateProblems("echo '{x}'").map(shellProblemMessage)).toEqual([
      `{x} can't be used in this command (it is inside single quotes); pass it as env: { NAME: '{x}' } and use "$NAME" in the script`
    ])
    expect(shellProblemMessage({ name: 'x', reason: 'r' })).not.toContain('double quotes')
  })

  it.each([
    ['a comment', '# 27" monitor\nfind . -name {x}'],
    ['a heredoc', 'cat <<EOF\n27"\n{x}\nEOF'],
    ['a nested sh -c in double quotes', 'sh -c "echo {x}"'],
    ['a nested bash -ec', "bash -ec 'echo {x}'"],
    ['a substitution', 'echo $(echo {x})'],
    ['a backtick', 'echo `echo {x}`'],
    ['ANSI quoting', "echo $'a' {x}"],
    ['eval', 'eval echo {x}'],
    ['xargs', 'ls | xargs echo {x}'],
    ['trap', 'trap "echo {x}" EXIT'],
    ['a [[ test', '[[ -n {x} ]] && echo y'],
    ['an arithmetic expression', 'echo $((1)) {x}'],
    ['let', 'let n={x}']
  ])('refuses any placeholder next to %s', (_n, template) => {
    const rendered = renderShellCommand(template, { x: 'z -o -exec touch MARK ;' })
    expect(rendered.ok).toBe(false)
    expect(shellTemplateProblems(template).map((p) => p.name)).toEqual(['x'])
  })

  it('allows a # that is not a comment, and a command with no placeholder', () => {
    expect(renderShellCommand('echo a#b "# {x}" $#', { x: '1' }).ok).toBe(true)
    expect(renderShellCommand('echo "$(date)" # fine', {}).ok).toBe(true)
  })

  it('judges a script path the same at load (as written) and at render (after resolveScriptCommand)', () => {
    const asWritten = './tools/{x}.sh --flag'
    const resolved = "'/a/tools/{x}.sh' --flag"
    expect(shellTemplateProblems(asWritten)).toEqual(shellTemplateProblems(resolved))
    expect(shellTemplateProblems(asWritten)).toHaveLength(1)
    expect(renderShellCommand(resolved, { x: 'v' }).ok).toBe(false)
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
  const CONTEXTS = [
    ['a bare argument', 'echo {x}'],
    ['double quotes', 'echo "a {x} b"'],
    ['a backslash before the placeholder', 'echo \\{x}'],
    ['a backslash in double quotes', 'echo "\\{x}"'],
    ['an earlier quoted word', `echo 'it' "s" {x}`]
  ] as const

  it.each(
    CONTEXTS.flatMap(([name, template]) => PAYLOADS.map((p) => [name, template, p] as const))
  )('%s, value %j', (_name, template, payload) => {
    const dir = mkdtempSync(join(tmpdir(), 'pilot-tpl-'))
    const rendered = renderShellCommand(template, { x: payload })
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

  it.each(PAYLOADS)(
    'an env: value %j reaches the script as one argument via "$NAME"',
    (payload) => {
      const dir = mkdtempSync(join(tmpdir(), 'pilot-tpl-'))
      const value = renderTemplate('{x}', { x: payload }).text
      const out = execFileSync('/bin/sh', ['-c', 'for a in "$NAME"; do printf "[%s]" "$a"; done'], {
        cwd: dir,
        env: { PATH: '/usr/bin:/bin', NAME: value },
        encoding: 'utf8'
      })
      expect(out).toBe(`[${payload}]`)
      expect(existsSync(join(dir, 'MARK'))).toBe(false)
    }
  )

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
