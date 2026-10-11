import { describe, expect, it } from 'vitest'
import type { FieldValue } from './api-types'
import { evalExpr, exprPlaceholders, parseExpr, type Expr } from './expr'

function parsed(src: string): Expr {
  const result = parseExpr(src)
  if (!result.ok) {
    throw new Error(result.error)
  }
  return result.expr
}

const field = (name: string) => ({ kind: 'field', name }) as const
const literal = (value: FieldValue) => ({ kind: 'literal', value }) as const

describe('parseExpr', () => {
  it('binds not tighter than and, and and tighter than or', () => {
    expect(parsed("{a} == 'x' and not {b} or {c}")).toEqual({
      kind: 'or',
      parts: [
        {
          kind: 'and',
          parts: [
            { kind: 'cmp', op: '==', left: field('a'), right: literal('x') },
            { kind: 'not', expr: { kind: 'value', operand: field('b') } }
          ]
        },
        { kind: 'value', operand: field('c') }
      ]
    })
  })

  it.each([
    [
      '{steps.review.changed} == true',
      { kind: 'cmp', op: '==', left: field('steps.review.changed'), right: literal(true) }
    ],
    ['{n} >= -1.5', { kind: 'cmp', op: '>=', left: field('n'), right: literal(-1.5) }],
    [
      '"say \\"hi\\"" != {s}',
      { kind: 'cmp', op: '!=', left: literal('say "hi"'), right: field('s') }
    ],
    ['null != {x}', { kind: 'cmp', op: '!=', left: literal(null), right: field('x') }],
    [
      'not not {x}',
      { kind: 'not', expr: { kind: 'not', expr: { kind: 'value', operand: field('x') } } }
    ]
  ])('reads %s', (src, expr) => {
    expect(parsed(src)).toEqual(expr)
  })

  it.each([
    ['', 'expected a value at the end'],
    ['{a} >', 'expected a value at the end'],
    ['{a b} > 1', "{a b} isn't a field name (write it like {mr.iid}, without spaces)"],
    ["'abc", "a string opened at 1 isn't closed"],
    [
      'mr.iid > 0',
      '"mr.iid" at 1 isn\'t a value: put fields in braces, like {mr.iid}, and text in quotes'
    ],
    ['{a} == 1 2', 'unexpected 2 at 10'],
    ['{a} = 1', 'unexpected "=" at 5'],
    ['{a', "a { at 1 isn't closed"],
    ['and {a}', 'expected a value at 1, found "and"'],
    ['{a} > 1 {b}', 'unexpected {b} at 9']
  ])('rejects %j: %s', (src, error) => {
    expect(parseExpr(src)).toEqual({ ok: false, error })
  })
})

describe('evalExpr', () => {
  const fields: Record<string, FieldValue> = {
    n: 3,
    s: 'abc',
    zero: 0,
    empty: '',
    yes: true,
    no: false,
    num: '5',
    when: '2026-10-11'
  }
  const lookup = (name: string): FieldValue | undefined => fields[name]

  it.each([
    ['{n} > 2', true],
    ['{n} >= 3', true],
    ['{n} < 3', false],
    ['{n} <= 3', true],
    ['{num} > 4', true],
    ["{n} == '3'", true],
    ["{s} == 'abc'", true],
    ['{s} != "abc"', false],
    ["{s} < 'b'", true],
    ["{when} >= '2026-10-01'", true],
    ['{s} > 1', false],
    ['{yes} == true', true],
    ['{yes} == "true"', true],
    ['{missing} > 0', false],
    ['{missing} != 0', false],
    ['{missing} == null', true],
    ['{missing} != null', false],
    ['{n} == null', false],
    ['{n} != null', true],
    ['null == {zero}', false],
    ['{missing}', false],
    ['{zero}', false],
    ['{empty}', false],
    ['{no}', false],
    ['{yes}', true],
    ['{s}', true],
    ['not {missing}', true],
    ['not {n} > 5', true],
    ['{no} or {n} > 1 and {s}', true],
    ['{no} or {n} > 5 and {s}', false],
    ['{yes} and {missing} or {zero}', false]
  ])('%s is %s', (src, expected) => {
    expect(evalExpr(parsed(src), lookup)).toBe(expected)
  })

  it('names each field it reads once, in reading order', () => {
    expect(exprPlaceholders(parsed('{a} > 1 and not {b.c} or {a} == {d}'))).toEqual([
      'a',
      'b.c',
      'd'
    ])
  })
})
