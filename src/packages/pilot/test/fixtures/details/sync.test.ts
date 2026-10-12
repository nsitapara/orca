import { existsSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

// The Details fixtures are byte copies of the samples in ~/.agents: when the samples change, these must too.
const HERE = import.meta.dirname
const SKILLS = join(homedir(), '.agents', 'skills')
const SAMPLE = join(SKILLS, 'worktree-gate', 'assets', 'sample-details')
const SOURCES: Record<string, string> = {
  'F2.json': join(SAMPLE, 'F2.json'),
  'F2.patch': join(SAMPLE, 'F2.patch'),
  'F2-before.png': join(SAMPLE, 'F2-before.png'),
  'F2-after.png': join(SAMPLE, 'F2-after.png'),
  'F2-qa.png': join(SAMPLE, 'F2-qa.png'),
  'sample-review.json': join(SKILLS, 'review-requests', 'previews', 'sample-review.json')
}

describe('the Details fixtures', () => {
  it.each(Object.entries(SOURCES))('%s equals its source in ~/.agents', (name, source) => {
    if (!existsSync(source)) {
      return
    }
    expect(readFileSync(join(HERE, name)).equals(readFileSync(source))).toBe(true)
  })
})
