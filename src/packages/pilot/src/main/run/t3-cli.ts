import { existsSync, statSync } from 'node:fs'
import { delimiter, join } from 'node:path'
import { pathToFileURL } from 'node:url'
import type { ExecResult } from './foreign-exec'

// The same transport as pilotd (its docs/t3.md, src/agent/foreign.rs): T3's own bundled CLI, run as Node with the
// preload resources/t3_hook.mjs.txt, which pins the launch to the project whose root is the repo's main checkout and binds
// it to the run's existing worktree. pilotd's env names (PILOTD_T3_*) and sentinel are the preload's, kept as they are.

// What Pilot always passes as `--worktree`, for the preload to swap for the existing worktree (or drop, for the root).
// No git ref can be named this, so a launch the preload didn't rewrite fails on T3's base check and creates no thread.
export const T3_SENTINEL = 'pilotd: existing worktree'

// T3's launcher (~/.t3/bin/t3, which T3 writes): the app it runs as Node, the bundled CLI, and T3's home.
export type T3LauncherScript = { launcher: string; app: string; cli: string; home: string | null }

// A thread launch: the repo's T3 project (by its root, the main checkout) and the worktree to bind (null: the root).
export type T3Launch = {
  repo: string
  projectRoot: string
  worktree: string | null
  branch: string | null
  title: string
  model: { provider: string; model: string } | null
}

export type T3Started = { threadId: string; projectId: string | null; runId: string | null }
export type T3Invocation = { bin: string; args: string[]; env: Record<string, string> }
// The preload's one-line report: {launch, rewritten, projectId, worktreePath, error}.
export type T3Report = { launch?: boolean; rewritten?: boolean; error?: string | null }

// POSIX words of one line, quotes removed and nothing expanded (`"$app"` stays `$app`). Null on an unclosed quote.
function shellWords(line: string): string[] | null {
  const words: string[] = []
  let word: string | null = null
  let quote: "'" | '"' | null = null
  for (let i = 0; i < line.length; i += 1) {
    const c = line[i]
    if (quote) {
      if (c === quote) {
        quote = null
      } else if (quote === '"' && c === '\\' && i + 1 < line.length) {
        i += 1
        word += line[i]
      } else {
        word += c
      }
    } else if (c === "'" || c === '"') {
      quote = c
      word ??= ''
    } else if (c === '\\' && i + 1 < line.length) {
      i += 1
      word = (word ?? '') + line[i]
    } else if (c === ' ' || c === '\t') {
      if (word !== null) {
        words.push(word)
        word = null
      }
    } else {
      word = (word ?? '') + c
    }
  }
  if (quote) {
    return null
  }
  if (word !== null) {
    words.push(word)
  }
  return words
}

// `app='…'`, `home='…'` and `exec "$app" '<cli>' "$@"`, as T3 writes them.
export function parseT3Launcher(launcher: string, text: string): T3LauncherScript | null {
  let app: string | null = null
  let home: string | null = null
  let cli: string | null = null
  for (const line of text.split('\n')) {
    const words = shellWords(line.trim())
    if (!words) {
      continue
    }
    if (words.length === 1 && words[0].startsWith('app=')) {
      app = words[0].slice('app='.length)
    } else if (words.length === 1 && words[0].startsWith('home=')) {
      home = words[0].slice('home='.length)
    } else if (
      words.length >= 3 &&
      words[0] === 'exec' &&
      words[1] === '$app' &&
      words[2].endsWith('.mjs')
    ) {
      cli = words[2]
    }
  }
  return app && cli ? { launcher, app, cli, home } : null
}

export function notT3sLauncher(launcher: string): Error {
  return new Error(
    `t3 (${launcher}) isn't T3's launcher (app='…' and exec "$app" '…/bin.mjs'): Pilot binds a thread to a worktree through T3's bundled CLI; point Pilot at T3's own t3 (open T3 once to write it)`
  )
}

// A bare command name (`t3`) as the file PATH finds; a path as is.
export function resolveOnPath(bin: string, path: string | undefined = process.env.PATH): string {
  if (bin.includes('/')) {
    return bin
  }
  for (const dir of (path ?? '').split(delimiter)) {
    const candidate = join(dir, bin)
    if (dir && existsSync(candidate) && statSync(candidate).isFile()) {
      return candidate
    }
  }
  return bin
}

// The program, args and env of a launch, with the preload at `hook` and its report at `report`. The prompt goes on stdin.
export function t3Invocation(
  launcher: T3LauncherScript,
  plan: T3Launch,
  hook: string,
  report: string
): T3Invocation {
  const args = [
    '--import',
    pathToFileURL(hook).href,
    launcher.cli,
    'thread',
    'start',
    '--title',
    plan.title
  ]
  if (plan.model) {
    args.push('--provider', plan.model.provider, '--model', plan.model.model)
  }
  // Always: a launch the preload didn't rewrite then fails on T3's base check, root launches too.
  args.push('--worktree', T3_SENTINEL, '--json', plan.projectRoot, '-')
  const env: Record<string, string> = {
    ELECTRON_RUN_AS_NODE: '1',
    T3CODE_CLI_PATH: launcher.launcher,
    PILOTD_T3_PROJECT_ROOT: plan.projectRoot,
    PILOTD_T3_REPORT: report
  }
  if (launcher.home) {
    env.T3CODE_HOME = launcher.home
  }
  if (plan.worktree) {
    env.PILOTD_T3_WORKTREE = plan.worktree
  }
  if (plan.branch) {
    env.PILOTD_T3_BRANCH = plan.branch
  }
  return { bin: launcher.app, args, env }
}

// The first line T3 said: stderr, else stdout.
function said(out: ExecResult): string {
  const text = out.stderr.trim() ? out.stderr : out.stdout
  return text.trim().split('\n')[0] ?? ''
}

function parsed(stdout: string): Record<string, unknown> | null {
  try {
    const value: unknown = JSON.parse(stdout.trim())
    return value && typeof value === 'object' ? (value as Record<string, unknown>) : null
  } catch {
    return null
  }
}

const text = (value: unknown): string | null => (typeof value === 'string' && value ? value : null)

// `t3 thread start --json`: {threadId, projectId, runId}, trusted only with a report saying the preload rewrote it.
export function t3Started(out: ExecResult, report: T3Report | null, plan: T3Launch): T3Started {
  const notAProject = `no T3 project has repo ${plan.repo}'s main checkout ${plan.projectRoot} as its root; add it in T3 (t3 project add ${plan.projectRoot}) or run the step on herdr`
  const error = report?.error
  if (typeof error === 'string' && error) {
    if (error.startsWith('no T3 project has') || error.startsWith('t3 picked project')) {
      throw new Error(`${notAProject} (${error})`)
    }
    throw new Error(`thread start refused: ${error}`)
  }
  const value = parsed(out.stdout)
  const threadId = text(value?.threadId)
  if (out.code === 0 && value && threadId) {
    if (report?.rewritten !== true) {
      const place = plan.worktree ?? plan.projectRoot
      throw new Error(
        `T3 thread ${threadId} started, but not through pilotd's preload: it may not be in ${place} or repo ${plan.repo}'s project`
      )
    }
    return { threadId, projectId: text(value.projectId), runId: text(value.runId) }
  }
  const line = said(out)
  if (line.includes('No T3 Code project matches')) {
    throw new Error(`${notAProject} (${line})`)
  }
  if (report === null) {
    throw new Error(`thread start failed before pilotd's preload ran: ${line || 'no output'}`)
  }
  if (out.code === 0) {
    throw new Error(`thread start printed no thread id: ${line}`)
  }
  throw new Error(`thread start failed: ${line || 'no output'}`)
}
