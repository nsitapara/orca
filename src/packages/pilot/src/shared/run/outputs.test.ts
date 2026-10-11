import { describe, expect, it } from 'vitest'
import { coerceOutputValue, outputsFromStdout, parseOutputPair, parseOutputPairs } from './outputs'

describe('coerceOutputValue', () => {
  it.each([
    ['true', true],
    ['false', false],
    ['3', 3],
    ['2.5', 2.5],
    ['null', null],
    ['"quoted"', 'quoted'],
    ['yes', 'yes'],
    ['{"a":1}', '{"a":1}'],
    ['', ''],
    ['  padded text  ', 'padded text']
  ])('%j → %j', (raw, value) => expect(coerceOutputValue(raw)).toEqual(value))
})

describe('parseOutputPair', () => {
  it.each([
    ['changed=true', { ok: true, key: 'changed', value: true }],
    ['report=a=b', { ok: true, key: 'report', value: 'a=b' }],
    ['=x', { ok: false, error: '"=x" isn\'t key=value' }],
    ['noequals', { ok: false, error: '"noequals" isn\'t key=value' }],
    [
      'bad-key=1',
      {
        ok: false,
        error: '"bad-key" isn\'t an output name: letters, digits and _, not starting with a digit'
      }
    ],
    [
      `big=${'x'.repeat(4097)}`,
      { ok: false, error: 'big: the value is longer than 4096 characters' }
    ]
  ])('%s', (text, expected) => expect(parseOutputPair(text)).toEqual(expected))

  it('collects every bad pair in parseOutputPairs', () => {
    expect(parseOutputPairs(['changed=true', 'oops', 'n=2'])).toEqual({
      ok: false,
      errors: ['"oops" isn\'t key=value']
    })
    expect(parseOutputPairs(['changed=true', 'n=2'])).toEqual({
      ok: true,
      outputs: { changed: true, n: 2 }
    })
  })
})

describe('outputsFromStdout', () => {
  it('reads ::pilot-output lines only, the last one per key winning, and reports bad lines', () => {
    const stdout = [
      'pruned 3 images',
      '::pilot-output found_bugs=1',
      '  ::pilot-output not=me',
      '::pilot-output found_bugs=2\r',
      '::pilot-output report=reports/qa 1.md',
      '::pilot-output bad-key=1'
    ].join('\n')
    expect(outputsFromStdout(stdout)).toEqual({
      outputs: { found_bugs: 2, report: 'reports/qa 1.md' },
      warnings: [
        '"bad-key" isn\'t an output name: letters, digits and _, not starting with a digit'
      ]
    })
  })
})
