import { describe, expect, it } from 'vitest'
import type { Effect } from '../../shared/visibility-types'
import { gitlabBaseOf, linearBaseOf, linkEffects, webBase } from './effect-links'

const effect = (
  kind: Effect['kind'],
  target: string | null,
  url: string | null = null
): Effect => ({
  kind,
  target,
  url,
  count: 1,
  stepIdx: 0,
  at: 1
})

describe('webBase', () => {
  it.each([
    ['git@gitlab.com:polygenx/web-platform.git', 'https://gitlab.com/polygenx/web-platform'],
    ['ssh://git@gitlab.com:22/g/p.git', 'https://gitlab.com/g/p'],
    ['https://gitlab.com/g/sub/p.git', 'https://gitlab.com/g/sub/p'],
    ['https://oauth2:tok@gitlab.com/g/p', 'https://gitlab.com/g/p'],
    ['/local/path', null]
  ])('%s', (remote, base) => {
    expect(webBase(remote)).toBe(base)
  })
})

describe('bases from URLs', () => {
  it('finds the GitLab project and the Linear workspace in URLs a run already has', () => {
    const urls = [
      'https://example.com/x',
      'https://gitlab.com/g/p/-/merge_requests/4',
      'https://linear.app/acme/issue/WEB-1/slug'
    ]
    expect(gitlabBaseOf(urls)).toBe('https://gitlab.com/g/p')
    expect(linearBaseOf(urls)).toBe('https://linear.app/acme')
    expect(gitlabBaseOf([])).toBeNull()
    expect(linearBaseOf([])).toBeNull()
  })
})

describe('linkEffects', () => {
  it("fills each effect's missing link from the bases, keeping links it brought", () => {
    const bases = { gitlab: 'https://gitlab.com/g/p', linear: 'https://linear.app/acme' }
    expect(
      linkEffects(
        [
          effect('pushed', 'web-1/fix'),
          effect('mr_opened', '!9'),
          effect('gitlab_write', 'projects/g%2Fp/jobs/77/retry'),
          effect('gitlab_write', 'projects/1/merge_requests/2/notes'),
          effect('ticket_commented', 'WEB-3'),
          effect('ticket_created', null),
          effect('action', 'created WEB-1', 'https://kept.example')
        ],
        bases
      ).map((e) => e.url)
    ).toEqual([
      'https://gitlab.com/g/p/-/tree/web-1/fix',
      'https://gitlab.com/g/p/-/merge_requests/9',
      'https://gitlab.com/g/p/-/jobs/77',
      null,
      'https://linear.app/acme/issue/WEB-3',
      null,
      'https://kept.example'
    ])
    expect(
      linkEffects([effect('mr_opened', '!9')], { gitlab: null, linear: null })[0].url
    ).toBeNull()
  })
})
