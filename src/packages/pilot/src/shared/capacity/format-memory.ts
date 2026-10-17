const MIB = 1024 ** 2
const GIB = 1024 ** 3

// "1.4 GB" from a gigabyte up, "850 MB" below it; binary units, as Activity Monitor shows them.
export function formatMemory(bytes: number): string {
  if (bytes >= GIB) {
    return `${(bytes / GIB).toFixed(1)} GB`
  }
  return `${Math.round(bytes / MIB)} MB`
}
