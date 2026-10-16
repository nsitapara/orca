import { describe, expect, it } from 'vitest'
import { findCommandSpec } from '../../../../cli/args'
import { buildHandlerRoutes, HANDLER_COMMAND_KEYS } from '../../../../cli/dispatch'
import { HANDLER_GROUPS, type HandlerGroup } from '../../../../cli/handler-group-manifest'
import { COMMAND_SPECS } from '../../../../cli/specs/index'
import { findVocabularyViolations } from '../../../../cli/vocabulary-policy'
import { PILOT_HANDLER_GROUPS } from './handler-groups'
import { PILOT_COMMAND_SPECS } from './specs'

const PILOT_KEYS = PILOT_HANDLER_GROUPS.flatMap((g) => g.keys)

// Pilot's commands share upstream's `automations` namespace. If upstream ever adds the same verb, the
// CLI throws at load (dispatch.ts builds its routes, Pilot's spread in, at import), so this test must fail first.
describe("Pilot's CLI commands in upstream's route table", () => {
  it("builds upstream's routes with Pilot's groups spread in, with no duplicate key", () => {
    expect(() => buildHandlerRoutes([...HANDLER_GROUPS, ...PILOT_HANDLER_GROUPS])).not.toThrow()
    for (const key of PILOT_KEYS) {
      expect(HANDLER_COMMAND_KEYS.has(key)).toBe(true)
    }
  })

  it('fails when upstream registers a command Pilot already has', () => {
    const upstreamClash: HandlerGroup = {
      name: 'automations',
      keys: ['automations status'],
      load: async () => ({})
    }
    expect(() => buildHandlerRoutes([upstreamClash, ...PILOT_HANDLER_GROUPS])).toThrow(
      'Duplicate CLI handler registration for "automations status"'
    )
  })

  it("follows the CLI's verb policy, and `automations get` still reaches Pilot's show-yaml", () => {
    expect(findVocabularyViolations(PILOT_COMMAND_SPECS)).toEqual([])
    expect(findCommandSpec(COMMAND_SPECS, ['automations', 'get'])?.path).toEqual([
      'automations',
      'show-yaml'
    ])
    expect(findCommandSpec(COMMAND_SPECS, ['automations', 'show'])?.path).toEqual([
      'automations',
      'show'
    ])
  })

  it('gives each Pilot command exactly one spec in the CLI', () => {
    const paths = COMMAND_SPECS.map((s) => s.path.join(' '))
    expect(PILOT_COMMAND_SPECS.map((s) => s.path.join(' ')).sort()).toEqual([...PILOT_KEYS].sort())
    for (const key of PILOT_KEYS) {
      expect(paths.filter((p) => p === key)).toEqual([key])
    }
  })
})
