import type { LinearIssueListResult } from '../../../../shared/linear/agent-access'
import type { LinearConnector } from '../../src/main/linear-connector/linear-connector'
import type { SourceAccess } from '../../src/main/scheduler/tick-decide'
import type { TickDeps } from '../../src/main/scheduler/tick-runner'
import { linearTicketSource } from '../../src/main/sources/linear-tickets'
import type { GitRunner } from '../../src/main/sources/worktree-git'
import { runtimeWorktreeRecords } from '../../src/main/sources/worktree-records'
import { fixtureRead, fixtureRuntime, stdoutOf, type ParityFixture } from './fixture'

function resultOf(f: ParityFixture, argv: string[]): unknown {
  const read = fixtureRead(f, argv)
  if ((read.code ?? 0) !== 0) {
    throw new Error(`${argv.join(' ')} failed: ${read.stderr ?? ''}`)
  }
  return (JSON.parse(stdoutOf(read)) as { result: unknown }).result
}

// Pilot's Linear connector over a case's reads (`orca linear list …` and `orca linear issue <ID> --workspace <id> …`,
// which the old sweep's own `orca linear issue <ID>` state read never collides with). A dry run writes nothing.
export function fixtureLinear(f: ParityFixture): LinearConnector {
  const refuse = (): Promise<never> =>
    Promise.reject(new Error('parity: a dry run never writes to Linear'))
  return {
    listIssues: async (filter) =>
      resultOf(f, [
        'orca',
        'linear',
        'list',
        '--filter',
        filter,
        '--workspace',
        'all',
        '--limit',
        '200',
        '--json'
      ]) as LinearIssueListResult,
    issue: async (id, workspaceId) => {
      const flag = workspaceId ? ['--workspace', workspaceId] : []
      const answer = resultOf(f, ['orca', 'linear', 'issue', id, ...flag, '--json'])
      return (answer as { issue: Awaited<ReturnType<LinearConnector['issue']>> }).issue
    },
    create: refuse,
    comment: refuse,
    setState: refuse,
    attach: refuse
  }
}

// `git show-ref --verify --quiet refs/heads/<branch>` in the main checkout, from the case: exit 1 is "no such branch".
function fixtureShowRef(f: ParityFixture): GitRunner {
  return async (args, { cwd }) => {
    const read = fixtureRead(f, ['git', '-C', cwd, ...args])
    if ((read.code ?? 0) !== 0) {
      throw Object.assign(new Error(`git ${args.join(' ')} exited ${read.code}`), {
        code: read.code
      })
    }
    return { stdout: stdoutOf(read) }
  }
}

// The tick's sources with the linear_ticket kind registered over the case: the real source (listing, details, branch
// facts, scope) with Linear, the worktree list and git answered by the fixture. Other kinds run as in production.
export function withLinearTickets(deps: TickDeps, f: ParityFixture): TickDeps {
  const source = linearTicketSource({
    linear: fixtureLinear(f),
    listWorktrees: runtimeWorktreeRecords(fixtureRuntime(f)),
    git: fixtureShowRef(f)
  })
  const sources: SourceAccess = {
    list: (def, ctx) =>
      def.items?.kind === 'linear_ticket'
        ? source.list(ctx, def.items.where)
        : deps.sources.list(def, ctx),
    scope(def, item, people) {
      if (def.items?.kind !== 'linear_ticket') {
        return deps.sources.scope(def, item, people)
      }
      const result = source.scope(item, def.items.where, people)
      return result.ok ? null : { verdict: result.verdict, reason: result.reason }
    }
  }
  return { ...deps, sources }
}
