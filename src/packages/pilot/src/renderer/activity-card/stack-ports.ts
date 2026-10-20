import type { WorkspacePort } from '../../../../../shared/workspace-ports'

/** A port the worktree's stack declares in `.env.ports`, matched to the live port serving it. */
export type StackPort = {
  envVar: string
  label: string
  port: number
  // A `*_URL` in the same file that points at this port: the stack's web page for it.
  url: string | null
  live: WorkspacePort
}

export const STACK_PORTS_FILE = '.env.ports'

type DeclaredPort = { envVar: string; port: number }

// Cove's labels: DB_PORT reads "DB", REDIS_PORT "Redis", CUSTOMER_PORTAL_PORT "Customer Portal".
export function stackPortLabel(envVar: string): string {
  const words = envVar
    .replace(/_PORT$/, '')
    .split('_')
    .filter(Boolean)
  if (words.length === 1 && words[0].length <= 3) {
    return words[0].toUpperCase()
  }
  return words.map((word) => word.charAt(0) + word.slice(1).toLowerCase()).join(' ')
}

function urlPort(value: string): number | null {
  try {
    const url = new URL(value)
    return url.port ? Number(url.port) : null
  } catch {
    return null
  }
}

/** The `*_PORT` and `*_URL` lines of an env file; every other line, and every other value, is ignored. */
export function parseStackEnv(content: string): {
  ports: DeclaredPort[]
  urls: { envVar: string; port: number; url: string }[]
} {
  const ports: DeclaredPort[] = []
  const urls: { envVar: string; port: number; url: string }[] = []
  for (const line of content.split(/\r?\n/)) {
    const match = /^\s*(?:export\s+)?([A-Z][A-Z0-9_]*)\s*=\s*["']?([^"'\s#]*)/.exec(line)
    if (!match) {
      continue
    }
    const [, envVar, value] = match
    if (envVar.endsWith('_PORT') && /^\d{1,5}$/.test(value)) {
      ports.push({ envVar, port: Number(value) })
    } else if (envVar.endsWith('_URL')) {
      const port = urlPort(value)
      if (port !== null) {
        urls.push({ envVar, port, url: value })
      }
    }
  }
  return { ports, urls }
}

// Web pages first (a URL that isn't the API's), then other pages, then the rest, each in file order.
function rank(port: { envVar: string; url: string | null }, urlVar: string | null): number {
  if (!port.url) {
    return 2
  }
  return urlVar?.includes('API') || port.envVar.includes('API') ? 1 : 0
}

/**
 * The stack's declared ports that are live in this worktree, web pages first. Live ports the file
 * doesn't declare are the `others`.
 */
export function buildStackPorts(
  content: string,
  livePorts: readonly WorkspacePort[]
): { stack: StackPort[]; others: WorkspacePort[] } {
  const { ports, urls } = parseStackEnv(content)
  const byPort = new Map(livePorts.map((live) => [live.port, live]))
  const seen = new Set<number>()
  const ranked: { stack: StackPort; rank: number }[] = []
  for (const declared of ports) {
    const live = byPort.get(declared.port)
    if (!live || seen.has(declared.port)) {
      continue
    }
    seen.add(declared.port)
    // Why prefer the unprefixed URL: VITE_* copies point at the same page.
    const urlMatch =
      urls.find((u) => u.port === declared.port && !u.envVar.startsWith('VITE_')) ??
      urls.find((u) => u.port === declared.port)
    const stack: StackPort = {
      envVar: declared.envVar,
      label: stackPortLabel(declared.envVar),
      port: declared.port,
      url: urlMatch?.url ?? null,
      live
    }
    ranked.push({ stack, rank: rank(stack, urlMatch?.envVar ?? null) })
  }
  return {
    stack: ranked.sort((a, b) => a.rank - b.rank).map((entry) => entry.stack),
    others: livePorts.filter((live) => !seen.has(live.port))
  }
}
