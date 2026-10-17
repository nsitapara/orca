import { runProcess } from '@orca/process-host'

export type ProcessRow = { pid: number; ppid: number; rssBytes: number }

// `ps -axo pid=,ppid=,rss=`: three numbers a line, RSS in KiB.
export function parsePsTable(text: string): ProcessRow[] {
  const rows: ProcessRow[] = []
  for (const line of text.split('\n')) {
    const match = /^\s*(\d+)\s+(\d+)\s+(\d+)\s*$/.exec(line)
    if (match) {
      rows.push({
        pid: Number(match[1]),
        ppid: Number(match[2]),
        rssBytes: Number(match[3]) * 1024
      })
    }
  }
  return rows
}

// The roots and all their descendants, each process counted once even when trees overlap. Summed RSS counts
// shared pages in every process, so it errs high, which is the safe side for a limit.
export function treeRssBytes(rows: readonly ProcessRow[], roots: readonly number[]): number {
  const rss = new Map<number, number>()
  const children = new Map<number, number[]>()
  for (const row of rows) {
    rss.set(row.pid, row.rssBytes)
    const siblings = children.get(row.ppid)
    if (siblings) {
      siblings.push(row.pid)
    } else {
      children.set(row.ppid, [row.pid])
    }
  }
  const seen = new Set<number>()
  const pending = roots.filter((pid) => rss.has(pid))
  let total = 0
  for (let pid = pending.pop(); pid !== undefined; pid = pending.pop()) {
    if (seen.has(pid)) {
      continue
    }
    seen.add(pid)
    total += rss.get(pid) ?? 0
    pending.push(...(children.get(pid) ?? []))
  }
  return total
}

// Null on Windows (no ps) or when ps fails: memory is then unmeasured, never zero.
export async function readProcessTable(): Promise<ProcessRow[] | null> {
  if (process.platform === 'win32') {
    return null
  }
  try {
    const result = await runProcess({
      program: '/bin/ps',
      args: ['-axo', 'pid=,ppid=,rss='],
      timeoutMs: 5_000,
      maxOutputBytes: 8 * 1024 * 1024
    })
    return result.code === 0 ? parsePsTable(result.stdout) : null
  } catch {
    return null
  }
}
