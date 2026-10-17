import { execFileSync } from 'node:child_process'
import { existsSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { envNameProblem, renderShellEnv, runPlaceholders } from './shell-template'

describe('runPlaceholders', () => {
  it.each([
    ['a dotted name', './x.sh {mr.title}', ['mr.title']],
    ['a step output', 'echo {steps.a.b} {steps.a.b}', ['steps.a.b']],
    ['an optional name, without its ?', 'echo {steps.a.b?}', ['steps.a.b']],
    ['${HOME}', 'echo "${HOME}" ${x}', []],
    ["awk '{print}'", "awk '{print}' file", []],
    ["jq '{title}'", "jq '{title}'", []],
    ['a comment and a heredoc', 'cat <<EOF # note\n"quoted\nEOF', []]
  ])('%s', (_n, command, names) => expect(runPlaceholders(command)).toEqual(names))
})

describe('envNameProblem', () => {
  it.each<[string, string | null]>([
    ['TITLE', null],
    ['_X1', null],
    ['title', "title isn't a usable name"],
    ['1X', "1X isn't a usable name"],
    ['PILOT_X', 'PILOT_X is reserved'],
    ['ORCA_X', 'ORCA_X is reserved'],
    ['LD_PRELOAD', 'LD_PRELOAD is reserved'],
    ['DYLD_INSERT_LIBRARIES', 'DYLD_INSERT_LIBRARIES is reserved'],
    ...[
      'PATH',
      'IFS',
      'HOME',
      'ENV',
      'BASH_ENV',
      'SHELLOPTS',
      'BASHOPTS',
      'PS4',
      'CDPATH',
      'GLOBIGNORE',
      'AGENT_RUN'
    ].map((n): [string, string | null] => [n, `${n} is reserved`])
  ])('%s', (name, problem) => {
    const got = envNameProblem(name)
    if (problem === null) {
      expect(got).toBeNull()
    } else {
      expect(got).toContain(problem)
    }
  })
})

describe('renderShellEnv', () => {
  it('fills dotted names as plain text and leaves everything else literal', () => {
    expect(
      renderShellEnv(
        { A: 'MR {mr.iid}: {mr.title} ${HOME} {print}' },
        { 'mr.iid': 12, 'mr.title': 'x' }
      )
    ).toEqual({ ok: true, env: { A: 'MR 12: x ${HOME} {print}' } })
  })

  it.each<[string, Record<string, string | number | null>, string]>([
    ['missing', {}, ''],
    ['null', { 'steps.test.outcome': null }, ''],
    ['present', { 'steps.test.outcome': 'done' }, 'done']
  ])('{field?} with a %s value', (_n, fields, said) => {
    expect(renderShellEnv({ SAID: '{steps.test.outcome?}' }, fields)).toEqual({
      ok: true,
      env: { SAID: said }
    })
  })

  it('keeps failing a missing value without the ?, next to an optional one', () => {
    expect(renderShellEnv({ A: '{a.b} {c.d?}' }, {})).toEqual({
      ok: false,
      missing: ['a.b']
    })
  })

  it('fails naming every missing value', () => {
    expect(renderShellEnv({ A: '{a.b}', B: '{c.d} {a.b}' }, { 'c.d': null })).toEqual({
      ok: false,
      missing: ['a.b', 'c.d']
    })
  })
})

// What an MR title or branch name can hold. Passed through env:, each must reach the script as one
// argument and never run, however the script uses "$NAME".
describe('an env: value reaches the script intact (real /bin/sh)', () => {
  const PAYLOADS = [
    '$(touch MARK)',
    '`touch MARK`',
    '"; touch MARK; "',
    "'; touch MARK; '",
    '\ntouch MARK\n',
    "$'\\'' ; touch MARK; #",
    'a[$(touch MARK)]',
    'z -o -exec touch MARK ;'
  ]
  const SCRIPTS = [
    ['printf', 'for a in "$NAME"; do printf "[%s]" "$a"; done'],
    ['a nested sh -c with $1', `sh -c 'printf "[%s]" "$1"' _ "$NAME"`],
    ['a variable assignment', 'x="$NAME"; printf "[%s]" "$x"']
  ] as const

  it.each(SCRIPTS.flatMap(([name, script]) => PAYLOADS.map((p) => [name, script, p] as const)))(
    '%s, value %j',
    (_name, script, payload) => {
      const dir = mkdtempSync(join(tmpdir(), 'pilot-env-'))
      const rendered = renderShellEnv({ NAME: '{a.b}' }, { 'a.b': payload })
      if (!rendered.ok) {
        throw new Error('expected the env to render')
      }
      const out = execFileSync('/bin/sh', ['-c', script], {
        cwd: dir,
        env: { PATH: '/usr/bin:/bin', ...rendered.env },
        encoding: 'utf8'
      })
      expect(out).toBe(`[${payload}]`)
      expect(existsSync(join(dir, 'MARK'))).toBe(false)
    }
  )
})
