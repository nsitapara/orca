import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { DRAFT_FORBIDDEN, DRAFT_GRANTED } from '../../src/main/answers/prompt'
import { skillsDir } from './old-side'

// Pilot decides whether an answer approved a drafted patch and says so on the card's prompt line; apply.md
// and the answers modes that point at it must quote those words, or an agent can't tell a grant from a refusal.
const GRANT_LEAD = DRAFT_GRANTED.split(', only by ')[0]
const FILES: [string, string][] = [
  ['item-details', 'references/apply.md'],
  ['review-cycles', 'modes/answers.md'],
  ['ui-qa', 'modes/answers.md']
]

describe.skipIf(!existsSync(skillsDir()))(
  'a drafted patch applies only on the grant Pilot writes',
  () => {
    it.each(FILES)('%s/%s quotes the grant and the refusal', (skill, file) => {
      const text = readFileSync(join(skillsDir(), skill, file), 'utf8')
      expect(text).toContain(GRANT_LEAD)
      expect(text).toContain(DRAFT_FORBIDDEN.split(';')[0])
    })

    it("apply.md quotes Pilot's refusal whole", () => {
      expect(
        readFileSync(join(skillsDir(), 'item-details', 'references', 'apply.md'), 'utf8')
      ).toContain(DRAFT_FORBIDDEN)
    })
  }
)
