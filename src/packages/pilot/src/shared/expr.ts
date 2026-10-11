import type { FieldValue } from './api-types'

// Pure (R1). The grammar is contract §4:
//   or := and ('or' and)*     and := not ('and' not)*     not := 'not' not | cmp
//   cmp := operand (op operand)?     operand := {name} | number | 'str' | "str" | true | false | null
// A missing field is null. A comparison with null is false, except against a written null:
// {x} == null asks whether x is missing, {x} != null whether it is there. A bare operand is true
// unless it is null, false, 0 or "".
export type CmpOp = '==' | '!=' | '>' | '>=' | '<' | '<='
export type Operand = { kind: 'field'; name: string } | { kind: 'literal'; value: FieldValue }
export type Expr =
  | { kind: 'or'; parts: Expr[] }
  | { kind: 'and'; parts: Expr[] }
  | { kind: 'not'; expr: Expr }
  | { kind: 'cmp'; op: CmpOp; left: Operand; right: Operand }
  | { kind: 'value'; operand: Operand }
export type Lookup = (name: string) => FieldValue | undefined

type Logic = 'and' | 'or' | 'not'
type Token =
  | { type: 'field'; name: string; at: number }
  | { type: 'literal'; value: FieldValue; at: number }
  | { type: 'logic'; word: Logic; at: number }
  | { type: 'op'; op: CmpOp; at: number }
  | { type: 'end'; at: number }

class ExprError extends Error {}

const FIELD_NAME = /^[A-Za-z_]\w*(?:\.\w+)*$/
const OPERATOR = /^(?:==|!=|>=|<=|>|<)/
const NUMBER = /^-?\d+(?:\.\d+)?/
const WORD = /^[A-Za-z_][\w.]*/
const LOGIC_WORDS: Record<string, Logic> = { and: 'and', or: 'or', not: 'not' }
const LITERAL_WORDS: Record<string, FieldValue> = { true: true, false: false, null: null }

function readString(src: string, start: number): { value: string; end: number } {
  const quote = src[start]
  let value = ''
  let i = start + 1
  while (i < src.length) {
    const c = src[i]
    if (c === quote) {
      return { value, end: i + 1 }
    }
    // A backslash keeps the next character as it is (\" inside "…", \' inside '…').
    const escaped = c === '\\' && i + 1 < src.length
    value += escaped ? src[i + 1] : c
    i += escaped ? 2 : 1
  }
  throw new ExprError(`a string opened at ${start + 1} isn't closed`)
}

function readField(src: string, start: number): { token: Token; end: number } {
  const close = src.indexOf('}', start)
  if (close === -1) {
    throw new ExprError(`a { at ${start + 1} isn't closed`)
  }
  const name = src.slice(start + 1, close)
  if (!FIELD_NAME.test(name)) {
    throw new ExprError(`{${name}} isn't a field name (write it like {mr.iid}, without spaces)`)
  }
  return { token: { type: 'field', name, at: start }, end: close + 1 }
}

function readWord(word: string, at: number): Token {
  if (Object.hasOwn(LOGIC_WORDS, word)) {
    return { type: 'logic', word: LOGIC_WORDS[word], at }
  }
  if (Object.hasOwn(LITERAL_WORDS, word)) {
    return { type: 'literal', value: LITERAL_WORDS[word], at }
  }
  throw new ExprError(
    `"${word}" at ${at + 1} isn't a value: put fields in braces, like {${word}}, and text in quotes`
  )
}

function tokenAt(src: string, at: number): { token: Token; end: number } {
  const c = src[at]
  if (c === '{') {
    return readField(src, at)
  }
  if (c === "'" || c === '"') {
    const { value, end } = readString(src, at)
    return { token: { type: 'literal', value, at }, end }
  }
  const rest = src.slice(at)
  const op = OPERATOR.exec(rest)
  if (op) {
    return { token: { type: 'op', op: op[0] as CmpOp, at }, end: at + op[0].length }
  }
  const num = NUMBER.exec(rest)
  if (num) {
    return { token: { type: 'literal', value: Number(num[0]), at }, end: at + num[0].length }
  }
  const word = WORD.exec(rest)
  if (word) {
    return { token: readWord(word[0], at), end: at + word[0].length }
  }
  throw new ExprError(`unexpected "${c}" at ${at + 1}`)
}

function tokenize(src: string): Token[] {
  const tokens: Token[] = []
  let at = 0
  while (at < src.length) {
    if (/\s/.test(src[at])) {
      at += 1
      continue
    }
    const { token, end } = tokenAt(src, at)
    tokens.push(token)
    at = end
  }
  tokens.push({ type: 'end', at: src.length })
  return tokens
}

function tokenText(t: Token): string {
  if (t.type === 'literal') {
    return JSON.stringify(t.value)
  }
  if (t.type === 'field') {
    return `{${t.name}}`
  }
  if (t.type === 'end') {
    return 'the end'
  }
  return `"${t.type === 'logic' ? t.word : t.op}"`
}

class Parser {
  private pos = 0

  constructor(private readonly tokens: Token[]) {}

  parse(): Expr {
    const expr = this.chain('or', () => this.chain('and', () => this.not()))
    const next = this.peek()
    if (next.type !== 'end') {
      throw new ExprError(`unexpected ${tokenText(next)} at ${next.at + 1}`)
    }
    return expr
  }

  private peek(): Token {
    return this.tokens[this.pos]
  }

  private take(): Token {
    const token = this.tokens[this.pos]
    this.pos += 1
    return token
  }

  private atLogic(word: Logic): boolean {
    const next = this.peek()
    return next.type === 'logic' && next.word === word
  }

  private chain(word: 'and' | 'or', part: () => Expr): Expr {
    const parts = [part()]
    while (this.atLogic(word)) {
      this.take()
      parts.push(part())
    }
    if (parts.length === 1) {
      return parts[0]
    }
    return { kind: word, parts }
  }

  private not(): Expr {
    if (this.atLogic('not')) {
      this.take()
      return { kind: 'not', expr: this.not() }
    }
    return this.cmp()
  }

  private cmp(): Expr {
    const left = this.operand()
    const next = this.peek()
    if (next.type !== 'op') {
      return { kind: 'value', operand: left }
    }
    this.take()
    return { kind: 'cmp', op: next.op, left, right: this.operand() }
  }

  private operand(): Operand {
    const token = this.take()
    if (token.type === 'field') {
      return { kind: 'field', name: token.name }
    }
    if (token.type === 'literal') {
      return { kind: 'literal', value: token.value }
    }
    if (token.type === 'end') {
      throw new ExprError('expected a value at the end')
    }
    throw new ExprError(`expected a value at ${token.at + 1}, found ${tokenText(token)}`)
  }
}

export function parseExpr(src: string): { ok: true; expr: Expr } | { ok: false; error: string } {
  try {
    return { ok: true, expr: new Parser(tokenize(src)).parse() }
  } catch (error) {
    if (error instanceof ExprError) {
      return { ok: false, error: error.message }
    }
    throw error
  }
}

function valueOf(o: Operand, lookup: Lookup): FieldValue {
  return o.kind === 'literal' ? o.value : (lookup(o.name) ?? null)
}

function writtenNull(o: Operand): boolean {
  return o.kind === 'literal' && o.value === null
}

function truthy(v: FieldValue): boolean {
  return v !== null && v !== false && v !== 0 && v !== ''
}

function asNumber(v: FieldValue): number | null {
  if (typeof v === 'number') {
    return v
  }
  const n = typeof v === 'string' && v.trim() !== '' ? Number(v) : Number.NaN
  return Number.isFinite(n) ? n : null
}

// Numbers compare as numbers (a numeric string beside a number counts as one); two strings as text.
function order(a: FieldValue, b: FieldValue): number | null {
  if (typeof a === 'number' || typeof b === 'number') {
    const x = asNumber(a)
    const y = asNumber(b)
    if (x === null || y === null) {
      return null
    }
    return x - y
  }
  if (typeof a === 'string' && typeof b === 'string') {
    if (a === b) {
      return 0
    }
    return a < b ? -1 : 1
  }
  return null
}

function equal(a: FieldValue, b: FieldValue): boolean {
  if (typeof a === typeof b) {
    return a === b
  }
  const o = order(a, b)
  if (o !== null) {
    return o === 0
  }
  return String(a) === String(b)
}

const ORDER_TESTS: Record<'>' | '>=' | '<' | '<=', (o: number) => boolean> = {
  '>': (o) => o > 0,
  '>=': (o) => o >= 0,
  '<': (o) => o < 0,
  '<=': (o) => o <= 0
}

function compare(e: Extract<Expr, { kind: 'cmp' }>, lookup: Lookup): boolean {
  if (writtenNull(e.left) || writtenNull(e.right)) {
    const other = writtenNull(e.left) ? valueOf(e.right, lookup) : valueOf(e.left, lookup)
    if (e.op === '==') {
      return other === null
    }
    if (e.op === '!=') {
      return other !== null
    }
    return false
  }
  const a = valueOf(e.left, lookup)
  const b = valueOf(e.right, lookup)
  if (a === null || b === null) {
    return false
  }
  if (e.op === '==') {
    return equal(a, b)
  }
  if (e.op === '!=') {
    return !equal(a, b)
  }
  const o = order(a, b)
  return o !== null && ORDER_TESTS[e.op](o)
}

export function evalExpr(expr: Expr, lookup: Lookup): boolean {
  switch (expr.kind) {
    case 'or':
      return expr.parts.some((p) => evalExpr(p, lookup))
    case 'and':
      return expr.parts.every((p) => evalExpr(p, lookup))
    case 'not':
      return !evalExpr(expr.expr, lookup)
    case 'value':
      return truthy(valueOf(expr.operand, lookup))
    case 'cmp':
      return compare(expr, lookup)
  }
}

function operandNames(o: Operand): string[] {
  return o.kind === 'field' ? [o.name] : []
}

function namesIn(expr: Expr): string[] {
  switch (expr.kind) {
    case 'or':
    case 'and':
      return expr.parts.flatMap(namesIn)
    case 'not':
      return namesIn(expr.expr)
    case 'value':
      return operandNames(expr.operand)
    case 'cmp':
      return [...operandNames(expr.left), ...operandNames(expr.right)]
  }
}

export function exprPlaceholders(expr: Expr): string[] {
  return [...new Set(namesIn(expr))]
}
