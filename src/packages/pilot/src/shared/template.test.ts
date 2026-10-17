import { describe, expect, it } from 'vitest'
import {
  oncePerKey,
  placeholderNames,
  renderTemplate,
  runFields,
  stepFields,
  type StepResult
} from './template'

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

describe('placeholderNames', () => {
  it('lists each placeholder once, in order, ignoring braces that are not one', () => {
    expect(placeholderNames('{a} {b.c} {a} { d } {e')).toEqual(['a', 'b.c'])
  })
})

describe('runFields', () => {
  it.each([
    ['America/Los_Angeles', '20261010'],
    ['Europe/London', '20261011']
  ])('dates a run at 06:30 UTC on 11 Oct in %s as %s', (timezone, date) => {
    expect(runFields({ automationId: 'memo', at: Date.UTC(2026, 9, 11, 6, 30), timezone })).toEqual(
      {
        'run.automation': 'memo',
        'run.date': date
      }
    )
  })

  it('adds the tick id once the tick has started (G3)', () => {
    expect(runFields({ automationId: 'memo', at: 0, timezone: 'UTC', tickId: 41 })).toEqual({
      'run.automation': 'memo',
      'run.date': '19700101',
      'run.tick': 41
    })
  })

  it('adds the run id once there is a run', () => {
    expect(
      runFields({ automationId: 'memo', at: 0, timezone: 'UTC', runId: 'memo-202610110630-t1-1' })
    ).toMatchObject({ 'run.id': 'memo-202610110630-t1-1' })
  })
})

describe('stepFields', () => {
  const steps: StepResult[] = [
    {
      name: 'review',
      status: 'done',
      exitCode: null,
      outputs: { changed: true, findings: 2, status: 'clean' }
    },
    { name: 'lint', status: 'failed', exitCode: 1, outputs: {} },
    { name: 'fix', status: 'pending', exitCode: null, outputs: {} }
  ]

  it("gives every earlier step by name, the one just before as previous, and a step's own status first", () => {
    expect(stepFields(steps, 2)).toEqual({
      'steps.review.changed': true,
      'steps.review.findings': 2,
      'steps.review.status': 'done',
      'steps.review.exit_code': null,
      'steps.lint.status': 'failed',
      'steps.lint.exit_code': 1,
      'previous.status': 'failed',
      'previous.exit_code': 1
    })
  })

  it('reads the first step as previous for the second, and nothing later', () => {
    const fields = stepFields(steps, 1)
    expect(fields).toMatchObject({ 'previous.changed': true, 'previous.status': 'done' })
    expect(fields).not.toHaveProperty(['steps.lint.status'])
  })

  it('has nothing before the first step', () => {
    expect(stepFields(steps, 0)).toEqual({})
  })

  it("fills a prompt from an earlier step's outputs", () => {
    expect(
      renderTemplate(
        'Fix {steps.review.findings} findings ({previous.status})',
        stepFields(steps, 1)
      ).text
    ).toBe('Fix 2 findings (done)')
  })

  it("adds a stored result's outcome, reason and data (compact JSON) over outputs of those names, and never lifts data's fields", () => {
    const withResult: StepResult[] = [
      {
        name: 'context',
        status: 'done',
        exitCode: 0,
        outputs: { outcome: 'ok', remote: 'abc', result: 'from the outputs file' },
        result: {
          command: 'skills get-context',
          outcome: 'ok',
          reason: '2 failed jobs',
          data: { pipeline_id: 2934, kinds: ['lint'] },
          meta: {}
        }
      },
      { name: 'fix', status: 'pending', exitCode: null, outputs: {} }
    ]
    const fields = stepFields(withResult, 1)
    expect(fields).toMatchObject({
      'steps.context.outcome': 'ok',
      'steps.context.reason': '2 failed jobs',
      'steps.context.result': '{"pipeline_id":2934,"kinds":["lint"]}',
      'steps.context.remote': 'abc',
      'previous.result': '{"pipeline_id":2934,"kinds":["lint"]}'
    })
    expect(fields).not.toHaveProperty('steps.context.pipeline_id')
  })

  it.each([
    [
      'meta.text',
      {
        command: 'c',
        outcome: 'ok',
        reason: 'r',
        data_omitted: 'may contain comment or ticket text'
      }
    ],
    [
      'too large',
      { command: 'c', outcome: 'ok', reason: 'r', meta: {}, data_omitted: 'too large (300 KB)' }
    ]
  ])('reads a result whose data was not kept (%s) as missing', (_n, result) => {
    const fields = stepFields(
      [{ name: 'context', status: 'done', exitCode: 0, outputs: {}, result }],
      1
    )
    expect(fields['steps.context.result']).toBeNull()
    expect(fields['steps.context.reason']).toBe('r')
  })
})
