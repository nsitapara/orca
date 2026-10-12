import { describe, expect, it } from 'vitest'
import type { UsageRow } from './report'
import { usageCsv } from './csv'

const row: UsageRow = {
  day: '2026-10-11',
  job: 'ci-fix-sweep',
  job_name: '05 · Fix failed CI on my MRs',
  source: 'pilot',
  agent: 'claude',
  model: 'claude-opus-5-5',
  session: 'p1',
  worktree: 'web-1493',
  cwd: '/w',
  started: '2026-10-11T10:10',
  title: 'Fix "lint", then push',
  requests: 1,
  input: 2,
  cache_read: 3,
  cache_write: 4,
  output: 5,
  tokens: 14,
  cost_usd: null
}

describe('usageCsv (Python csv.DictWriter: minimal quoting, CRLF, no cwd column)', () => {
  it('writes the header and one line per row', () => {
    expect(usageCsv([row])).toBe(
      'day,job,job_name,source,agent,model,session,worktree,started,title,requests,input,cache_read,cache_write,output,tokens,cost_usd\r\n' +
        '2026-10-11,ci-fix-sweep,05 · Fix failed CI on my MRs,pilot,claude,claude-opus-5-5,p1,web-1493,2026-10-11T10:10,"Fix ""lint"", then push",1,2,3,4,5,14,\r\n'
    )
  })
})
