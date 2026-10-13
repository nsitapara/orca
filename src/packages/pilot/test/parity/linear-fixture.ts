import type { LinearIssueListResult } from '../../../../shared/linear/agent-access'
import type { LinearConnector } from '../../src/main/linear-connector/linear-connector'
import type { SourceAccess } from '../../src/main/scheduler/tick-decide'
import type { TickDeps } from '../../src/main/scheduler/tick-runner'
import { linearTicketSource } from '../../src/main/sources/linear-tickets'
import { runtimeWorktreeRecords } from '../../src/main/sources/worktree-records'
import { fixtureRead, fixtureRuntime, stdoutOf, type ParityFixture } from './fixture'
import { fixtureGitRunner } from './worktree-fixture'

function resultOf(f: ParityFixture, argv: string[]): unknown {
  const read = fixtureRead(f, argv)
  if ((read.code ?? 0) !== 0) {
    throw new Error(`${argv.join(' ')} failed: ${read.stderr ?? ''}`)
  }
  return (JSON.parse(stdoutOf(read)) as { result: unknown }).result
}

// The workspace a read by identifier alone resolves in: Linear looks across the signed-in workspaces, and a case's world
// has the one its Pilot-side reads name. None when the case holds no such read for the ticket.
function workspaceOf(f: ParityFixture, id: string): string | undefined {
  const named = new Set(
    f.reads
      .filter((r) => r.argv.slice(0, 5).join(' ') === `orca linear issue ${id} --workspace`)
      .map((r) => r.argv[5])
  )
  return named.size === 1 ? [...named][0] : undefined
}

// Pilot's Linear connector over a case's reads (`orca linear list …` and `orca linear issue <ID> --workspace <id> …`,
// which the old sweep's own `orca linear issue <ID>` state read never collides with). A read by identifier alone
// (where.ids_from) is the case's read in its workspace, else that state read. A dry run writes nothing.
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
      const workspace = workspaceId ?? workspaceOf(f, id)
      const flag = workspace ? ['--workspace', workspace] : []
      const answer = resultOf(f, ['orca', 'linear', 'issue', id, ...flag, '--json'])
      return (answer as { issue: Awaited<ReturnType<LinearConnector['issue']>> }).issue
    },
    create: refuse,
    comment: refuse,
    setState: refuse,
    attach: refuse
  }
}

// The tick's sources with the linear_ticket kind registered over the case: the real source (listing, details, branch
// facts, scope) with Linear, the worktree list and git answered by the fixture. Other kinds run as in production.
export function withLinearTickets(deps: TickDeps, f: ParityFixture): TickDeps {
  const source = linearTicketSource({
    linear: fixtureLinear(f),
    listWorktrees: runtimeWorktreeRecords(fixtureRuntime(f)),
    git: fixtureGitRunner(f) // `git show-ref --verify --quiet refs/heads/<branch>`: exit 1 is "no such branch"
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
