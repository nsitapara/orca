import type { SourceAccess } from '../../src/main/scheduler/tick-decide'
import type { TickDeps } from '../../src/main/scheduler/tick-runner'
import { runtimeWorktreeRecords } from '../../src/main/sources/worktree-records'
import { worktreeSource } from '../../src/main/sources/worktrees'
import type { GitRunner } from '../../src/main/sources/worktree-git'
import { fixtureRead, fixtureRuntime, NotInFixture, stdoutOf, type ParityFixture } from './fixture'

// `git -C <cwd> <args>` answered from the case, for a source's own git reads: a recorded non-zero exit throws with
// git's code (1 "no", 128 "not found"), and a recorded timeout as a killed child, as the git runner does.
export function fixtureGitRunner(f: ParityFixture): GitRunner {
  return async (args, { cwd }) => {
    const argv = ['git', '-C', cwd, ...args]
    const read = fixtureRead(f, argv)
    if (read.timeout) {
      throw Object.assign(new Error(`${argv.join(' ')} timed out`), { killed: true })
    }
    if ((read.code ?? 0) !== 0) {
      throw Object.assign(new Error(`git ${args.join(' ')} exited ${read.code}`), {
        code: read.code
      })
    }
    return { stdout: stdoutOf(read) }
  }
}

// Whether a path exists, as the old side's Path.exists saw it. A path the case lacks fails the listing, so the tick
// fails and parity-case.ts reports it.
export function fixtureExists(f: ParityFixture, path: string): boolean {
  const exists = f.exists[path]
  if (exists === undefined) {
    throw new NotInFixture(`exists ${path}`)
  }
  return exists
}

// The tick's sources with the worktree kind registered over the case: the real source (Orca's listing, the branch's
// MRs and approvals, the commits since the marker, scope) with Orca, git and GitLab answered by the fixture, and each
// worktree's marker read from the store the tick runs on (the imported or handled `<worktree id>@<sha>` keys). Other
// kinds run as in production.
export function withWorktrees(deps: TickDeps, f: ParityFixture): TickDeps {
  const source = worktreeSource({
    listWorktrees: runtimeWorktreeRecords(fixtureRuntime(f)),
    git: fixtureGitRunner(f),
    markers: (automationId) => deps.store.markers.progressMarkers(automationId),
    pathExists: (path) => fixtureExists(f, path)
  })
  const sources: SourceAccess = {
    list: (def, ctx) =>
      def.items?.kind === 'worktree'
        ? source.list(ctx, def.items.where)
        : deps.sources.list(def, ctx),
    scope(def, item, people) {
      if (def.items?.kind !== 'worktree') {
        return deps.sources.scope(def, item, people)
      }
      const result = source.scope(item, def.items.where, people)
      return result.ok ? null : { verdict: result.verdict, reason: result.reason }
    }
  }
  return { ...deps, sources }
}
