import { describe, expect, it } from 'vitest'
import { oncePerKey, renderTemplate } from './template'

const fields = {
  'mr.iid': 1561,
  'mr.pipeline': 2934410022,
  'mr.branch': 'web-1493-x',
  'mr.draft': false,
  'worktree.path': null
}

describe('renderTemplate', () => {
  it('fills field names in braces', () => {
    expect(
      renderTemplate('Fix {mr.pipeline} on !{mr.iid} ({mr.branch}), draft={mr.draft}', fields)
    ).toEqual({
      text: 'Fix 2934410022 on !1561 (web-1493-x), draft=false',
      missing: []
    })
  })

  it('leaves unknown or null fields in place and lists them once', () => {
    expect(renderTemplate('{worktree.path} {nope} {nope}', fields)).toEqual({
      text: '{worktree.path} {nope} {nope}',
      missing: ['worktree.path', 'nope']
    })
  })

  it('ignores braces that are not field names', () => {
    expect(renderTemplate('if (x) { y }', fields).text).toBe('if (x) { y }')
  })

  it('leaves prototype names unresolved', () => {
    expect(renderTemplate('{constructor} {toString}', {})).toEqual({
      text: '{constructor} {toString}',
      missing: ['constructor', 'toString']
    })
  })

  it('leaves an unclosed brace as is without reporting it', () => {
    expect(renderTemplate('a {mr.iid', fields)).toEqual({ text: 'a {mr.iid', missing: [] })
  })

  it('leaves whitespace inside braces literal without reporting it', () => {
    expect(renderTemplate('{ mr.iid }', fields)).toEqual({ text: '{ mr.iid }', missing: [] })
  })
})

describe('oncePerKey', () => {
  it('renders the template', () =>
    expect(oncePerKey('{mr.iid}:{mr.pipeline}', fields, '!1561')).toBe('1561:2934410022'))
  it('falls back to the item key without a template', () =>
    expect(oncePerKey(null, fields, '!1561')).toBe('!1561'))
  it('marks keys with missing fields so they never collide with real ones', () => {
    expect(oncePerKey('{mr.iid}:{mr.head}', fields, '!1561')).toBe(
      '1561:{mr.head}#missing:mr.head#!1561'
    )
  })
  it('keeps two items missing the same field on different keys', () => {
    const a = oncePerKey('{mr.head}', {}, '!1')
    const b = oncePerKey('{mr.head}', {}, '!2')
    expect(a).not.toBe(b)
  })
})
