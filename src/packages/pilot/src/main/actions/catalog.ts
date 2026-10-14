import type { Power } from '../../shared/definition/types'
import type { LinearWriter } from '../linear-connector/linear-writer'
import type { ActBridge } from './act-bridge'
import { linearEntries } from './linear-entries'
import { actionFailed, type ActionCatalog, type ActionEntry } from './types'

type Bridged = {
  name: string
  script: string
  power: Power
  label: string
  usage: string
  except?: true
}

// act.py's catalog scripts (~/.agents/skills/worktree-gate/actions), run as they are. Their args object is
// `{ "argv": [...] }`, act.py's positional arguments, which pin the state the action was proposed against;
// the scripts refuse with `stale` when it moved. push is pilotcli's (push-branch.ts), not act.py's.
const BRIDGED: Bridged[] = [
  {
    name: 'mark_ready',
    script: 'mark-ready',
    power: 'mark_ready',
    label: 'Mark a draft MR ready for review',
    usage: 'mark_ready { "argv": [<iid>, <head sha>] }'
  },
  {
    name: 'post_review',
    script: 'post-review',
    power: 'post',
    label: 'Post a prepared review on an MR',
    usage: 'post_review { "argv": [<iid>, <review file>, <sha256>] }',
    except: true
  }
]

// `{ "argv": [<string>…] }` and nothing else.
function argvOf(args: Record<string, unknown>): string[] | null {
  const { argv } = args
  const only = Object.keys(args).length === 1
  return only && Array.isArray(argv) && argv.every((a) => typeof a === 'string')
    ? (argv as string[])
    : null
}

function bridged(spec: Bridged, act: ActBridge): ActionEntry {
  const usage = `usage: ${spec.usage}`
  const entry: ActionEntry = {
    name: spec.name,
    power: spec.power,
    label: spec.label,
    usage: spec.usage,
    checkArgs: (args) => (argvOf(args) ? null : usage),
    describe: async (args) => {
      const argv = argvOf(args)
      return argv ? act.describe(spec.script, argv) : spec.usage
    },
    command: (args) => {
      const argv = argvOf(args)
      return argv ? act.command(spec.script, argv) : null
    },
    run: async (args, opts) => {
      const argv = argvOf(args)
      return argv ? act.run(spec.script, argv, opts) : actionFailed(usage)
    },
    refresh: async (args) => {
      const argv = argvOf(args)
      const got = argv ? await act.refresh(spec.script, argv) : null
      return got ? { args: { argv: got.argv }, changed: got.changed } : null
    }
  }
  if (spec.except) {
    entry.exceptArgs = (args, leftOut) => ({
      ...args,
      argv: [...(argvOf(args) ?? []), '--except', leftOut.join(',')]
    })
  }
  return entry
}

export function buildActionCatalog(deps: {
  act: ActBridge
  push: ActionEntry
  linear: LinearWriter | null
  extra?: ActionEntry[]
}): ActionCatalog {
  const all = [
    deps.push,
    ...BRIDGED.map((s) => bridged(s, deps.act)),
    ...linearEntries(deps.linear),
    ...(deps.extra ?? [])
  ]
  const byName = new Map<string, ActionEntry>()
  for (const entry of all) {
    if (byName.has(entry.name)) {
      throw new Error(`Two catalog entries are named "${entry.name}"`)
    }
    byName.set(entry.name, entry)
  }
  return { entries: () => [...all], get: (name) => byName.get(name) ?? null }
}
