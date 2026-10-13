import { describe, expect, it } from 'vitest'
import { splitArgv } from './argv'

describe('splitArgv: a command as plain words, run without a shell', () => {
  it.each([
    [
      'python3 /a/pilot_mode.py list-fix-tickets',
      ['python3', '/a/pilot_mode.py', 'list-fix-tickets']
    ],
    ['  tool\t--flag=x  ', ['tool', '--flag=x']],
    [`tool 'two words' "and three words"`, ['tool', 'two words', 'and three words']],
    [`tool '' "a'b" 'c"d'`, ['tool', '', "a'b", 'c"d']],
    [`tool pre'fix'ed`, ['tool', 'prefixed']]
  ])('%s', (command, argv) => {
    expect(splitArgv(command)).toEqual({ ok: true, argv })
  })

  it.each([
    ['', 'empty command'],
    ['   ', 'empty command'],
    [`tool 'open`, 'unterminated quote'],
    ['tool "open', 'unterminated quote'],
    ['tool | head', '"|" is shell syntax'],
    ['tool; rm -rf x', '";" is shell syntax'],
    ['tool && other', '"&" is shell syntax'],
    ['tool > out', '">" is shell syntax'],
    ['tool $(id)', '"$" is never allowed'],
    [`tool '$HOME'`, '"$" is never allowed'],
    ['tool `id`', '"`" is never allowed'],
    ['tool a\\ b', '"\\" is never allowed'],
    ['tool *.json', '"*" is shell syntax'],
    ['tool ~/x', '"~" is shell syntax'],
    ['tool # note', '"#" is shell syntax'],
    ['tool\nother', 'is never allowed'],
    ['NAME=1 tool', 'NAME=value before the command']
  ])('refuses %j', (command, error) => {
    const result = splitArgv(command)
    expect(result.ok).toBe(false)
    expect(result.ok ? '' : result.error).toContain(error)
  })
})
