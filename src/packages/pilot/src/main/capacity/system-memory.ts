import { readFile } from 'node:fs/promises'
import { freemem, totalmem } from 'node:os'
import { runProcess } from '@orca/process-host'

export type SystemMemory = { totalBytes: number; availableBytes: number }

// The kernel's free percentage (kern.memorystatus_level), the figure macOS's memory pressure is read from: it also
// counts what the kernel can reclaim from file caches and the compressor, which vm_stat's free pages leave out.
export function parseMemoryStatusLevel(text: string, totalBytes: number): number | null {
  const match = /^\s*(\d+)\s*$/.exec(text)
  const percent = match ? Number(match[1]) : Number.NaN
  return percent >= 0 && percent <= 100 ? Math.round((percent / 100) * totalBytes) : null
}

// The fallback where the kernel's level can't be read: free, inactive and speculative pages, as web-platform's
// e2e-parallel.sh counts it. os.freemem() on macOS is free pages only, a small fraction of that.
export function parseVmStat(text: string): number | null {
  const size = /page size of (\d+) bytes/.exec(text)
  if (!size) {
    return null
  }
  let pages = 0
  for (const kind of ['free', 'inactive', 'speculative']) {
    const match = new RegExp(`^Pages ${kind}:\\s+(\\d+)`, 'm').exec(text)
    pages += match ? Number(match[1]) : 0
  }
  return pages * Number(size[1])
}

export function parseMemAvailable(text: string): number | null {
  const match = /^MemAvailable:\s+(\d+)\s+kB/m.exec(text)
  return match ? Number(match[1]) * 1024 : null
}

async function availableBytes(): Promise<number | null> {
  try {
    if (process.platform === 'darwin') {
      const level = await runProcess({
        program: '/usr/sbin/sysctl',
        args: ['-n', 'kern.memorystatus_level'],
        timeoutMs: 5_000
      })
      const fromLevel = level.code === 0 ? parseMemoryStatusLevel(level.stdout, totalmem()) : null
      if (fromLevel !== null) {
        return fromLevel
      }
      const result = await runProcess({ program: '/usr/bin/vm_stat', timeoutMs: 5_000 })
      return result.code === 0 ? parseVmStat(result.stdout) : null
    }
    if (process.platform === 'linux') {
      return parseMemAvailable(await readFile('/proc/meminfo', 'utf8'))
    }
  } catch {}
  return null
}

// Windows' os.freemem() is already the available figure; elsewhere it is only the fallback.
export async function readSystemMemory(): Promise<SystemMemory> {
  return { totalBytes: totalmem(), availableBytes: (await availableBytes()) ?? freemem() }
}
