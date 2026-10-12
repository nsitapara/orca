// The Run line an action card shows: what approving it runs, written by Pilot from the stored card (the
// action and the args approval runs, as a refresh or revision left them), never from the agent's words.
export const RUN_LINE_MAX = 300

export type UsageLookup = { get(name: string): { usage: string } | null }

// `{ "argv": [<string>…] }` and nothing else: an act.py entry's positional arguments.
function argvOf(args: Record<string, unknown>): string[] | null {
  const { argv } = args
  const only = Object.keys(args).length === 1
  return only && Array.isArray(argv) && argv.every((a) => typeof a === 'string')
    ? (argv as string[])
    : null
}

// The names in an act.py entry's usage: `push { "argv": [<worktree path>, <branch>] }` → both.
function argvNames(usage: string | null): string[] {
  const list = usage?.match(/"argv":\s*\[([^\]]*)\]/)?.[1] ?? ''
  return [...list.matchAll(/<([^>]+)>/g)].map((m) => m[1])
}

function shellWord(word: string): string {
  if (/^[\w@%+=:,./-]+$/.test(word)) {
    return word
  }
  return `'${word.replaceAll("'", "'\\''")}'`
}

function argvText(action: string, argv: string[], names: string[]): string {
  const named = argv.slice(0, names.length).map((a, i) => ` · ${names[i]} ${shellWord(a)}`)
  const rest = argv.slice(names.length).map((a) => ` ${shellWord(a)}`)
  return `${action}${named.join('')}${rest.join('')}`
}

function capped(line: string): string {
  return line.length > RUN_LINE_MAX ? `${line.slice(0, RUN_LINE_MAX - 1)}…` : line
}

// One line, at most RUN_LINE_MAX: an act.py entry's argv named by its catalog usage (bare when the catalog
// lacks the action), any other args as compact JSON (whose escapes keep it on one line).
export function actionRunLine(
  action: string,
  args: Record<string, unknown>,
  usage: string | null
): string {
  const argv = argvOf(args)
  if (argv) {
    return capped(argvText(action, argv, argvNames(usage)).replace(/\s+/g, ' '))
  }
  return capped(`${action} ${JSON.stringify(args)}`)
}
