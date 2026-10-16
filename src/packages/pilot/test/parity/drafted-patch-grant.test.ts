import { createHash } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { DRAFT_FORBIDDEN, DRAFT_GRANTED } from '../../src/main/answers/prompt'
import { DRAFT_ON_DESKTOP, DRAFT_OPTION_ON_DESKTOP } from '../../src/shared/pilot-replies'
import { cliHarness } from '../../src/main/inbox/__fixtures__/cli-harness'
import { markReady } from '../../src/main/inbox/__fixtures__/prepared'
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

    // The agent's re-ask for a drafted change asked for off the desktop is Pilot's own, for each kind of card.
    it.each([DRAFT_ON_DESKTOP, DRAFT_OPTION_ON_DESKTOP])(
      'apply.md quotes the re-ask "%s"',
      (reask) => {
        expect(
          readFileSync(join(skillsDir(), 'item-details', 'references', 'apply.md'), 'utf8')
        ).toContain(`reply="${reask}"`)
      }
    )
  }
)

// apply.md's gate reads the grant out of `pilot inbox show --id <id> --json`, which prints the runtime's
// envelope ({id, ok, result: <the card>, _meta}): the key paths it names must be the ones that output has.
const GATE_KEYS = ['result.details.draftApproved', 'result.details.sha256']
// candidate.md is left out: it reads no grant at all (its own contract is checked below), so the key-path check would
// check nothing there.
const DOCS: [string, string][] = FILES

function keyPaths(text: string): string[] {
  return [...text.matchAll(/`(result\.details\.[A-Za-z0-9]+)`/g)].map((m) => m[1])
}

function at(value: unknown, path: string): unknown {
  return path
    .split('.')
    .reduce<unknown>((v, key) => (v as Record<string, unknown> | undefined)?.[key], value)
}

// A drafted bug card approved in Pilot's window, shown through the CLI's own `inbox show --json`.
async function shownJson(): Promise<{ shown: unknown; sha256: string }> {
  vi.stubEnv('PILOT_RUN_ID', 'run-1')
  vi.stubEnv('PILOT_STEP_IDX', '0')
  vi.stubEnv('PILOT_AUTOMATION_ID', '')
  vi.stubEnv('PILOT_ITEM_KEY', '')
  const log = vi.spyOn(console, 'log').mockImplementation(() => undefined)
  const { f, store, cli } = cliHarness()
  await cli([
    'inbox',
    'add',
    '--type',
    'bug',
    '--title',
    'Guard the null?',
    '--details-bundle',
    f.bundle
  ])
  const [item] = store.inbox.list()
  markReady(store, item.id) // R-P5: a drafted change is granted only on a prepared, ready card
  const answer = { option: null, text: 'approve', digest: item.digest, via: 'page' as const }
  store.inbox.saveAnswer(item.id, { ...answer, callerKind: 'desktop' }, 'nish', 110)
  log.mockClear()
  await cli(['inbox', 'show', '--id', item.id, '--json'])
  const sha256 = createHash('sha256').update(readFileSync(f.bundle)).digest('hex')
  return { shown: JSON.parse(String(log.mock.calls[0][0])), sha256 }
}

describe.skipIf(!existsSync(skillsDir()))(
  'the grant is read where pilot inbox show --json puts it',
  () => {
    afterEach(() => {
      vi.unstubAllEnvs()
      vi.restoreAllMocks()
    })

    it('apply.md names the key paths of the grant and its sha', () => {
      const text = readFileSync(join(skillsDir(), 'item-details', 'references', 'apply.md'), 'utf8')
      expect(new Set(keyPaths(text))).toEqual(new Set(GATE_KEYS))
    })

    it.each(DOCS)('%s/%s never names a details key outside result', (skill, file) => {
      const text = readFileSync(join(skillsDir(), skill, file), 'utf8')
      // details.py is the script, not a key.
      expect(text).not.toMatch(/`details\.(?!py`)[A-Za-z0-9]+`/)
      expect(text).not.toMatch(/"draftApproved"/)
    })

    it("those paths hold the grant and the bundle's sha in the CLI's real output", async () => {
      const { shown, sha256 } = await shownJson()
      expect(shown).toMatchObject({ ok: true })
      expect(at(shown, 'result.details.draftApproved')).toBe(true)
      expect(at(shown, 'result.details.sha256')).toBe(sha256)
      for (const key of GATE_KEYS) {
        expect(at(shown, key)).toBeDefined()
      }
    })
  }
)

// Candidate mode drafts for job 14's worker and never touches a card: no grant to read, nothing to apply or attach.
describe.skipIf(!existsSync(skillsDir()))(
  'item-details candidate mode returns a candidate only',
  () => {
    it('never attaches, completes, adds a card, runs an action, commits or pushes', () => {
      const text = readFileSync(join(skillsDir(), 'item-details', 'modes', 'candidate.md'), 'utf8')
      expect(text).toContain(
        'This mode returns a candidate; it never attaches Details or clears an answer.'
      )
      expect(text).toContain(
        'Do not run `extend-card`, `set-details` or `inbox update-preparation --complete`, post a card (`inbox-card`), or run action commands.'
      )
      expect(text).toContain('Never commit or push.')
      expect(text).not.toMatch(/draftApproved/)
    })
  }
)
