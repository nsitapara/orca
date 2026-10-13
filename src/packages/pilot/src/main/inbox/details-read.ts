import { createHash } from 'node:crypto'
import { closeSync, constants, fstatSync, openSync, readSync } from 'node:fs'
import { DETAILS_REFUSED } from '../../shared/details'

// Every refusal fails closed: nothing of the bundle is kept, and the message says why.
export class DetailsRefused extends Error {
  readonly reason: string
  constructor(reason: string) {
    super(`${DETAILS_REFUSED}: ${reason}`)
    this.name = 'DetailsRefused'
    this.reason = reason
  }
}

export const sha256 = (data: string | Buffer): string =>
  createHash('sha256').update(data).digest('hex')
const NOFOLLOW = constants.O_NOFOLLOW ?? 0

// A regular file's bytes through one descriptor, opened without following a last symlink, checked with
// fstat before anything is read, and never more than it said. Accepted race: O_NOFOLLOW covers only the
// last path part, so a parent folder swapped for a symlink between realInside's check and this open could
// lead outside the root. That needs write access to the vault already, and reaches only a file of the
// same name (a .json bundle or review, or an image), still capped and type-checked here.
export function readCapped(real: string, max: number, label: string): Buffer {
  let fd: number
  try {
    fd = openSync(real, constants.O_RDONLY | NOFOLLOW)
  } catch {
    throw new DetailsRefused(`${label} can't be opened`)
  }
  try {
    const stat = fstatSync(fd)
    if (!stat.isFile()) {
      throw new DetailsRefused(`${label} is not a file`)
    }
    if (stat.size > max) {
      throw new DetailsRefused(`${label} is over ${max} bytes`)
    }
    const buffer = Buffer.alloc(stat.size)
    let read = 0
    while (read < stat.size) {
      const n = readSync(fd, buffer, read, stat.size - read, read)
      if (n === 0) {
        break
      }
      read += n
    }
    return buffer.subarray(0, read)
  } finally {
    closeSync(fd)
  }
}
