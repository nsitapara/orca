import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const read = (p: string): string[] => readFileSync(join(import.meta.dirname, p), 'utf8').split('\n')
const upstream = read('../../../../../resources/darwin/bin/orca')

function diff(lines: string[]): string[] {
  const rest = [...lines]
  const out: string[] = []
  for (const u of upstream) {
    const i = rest.indexOf(u)
    if (i === -1) {
      out.push(`- ${u}`)
    } else {
      rest.splice(i, 1)
    }
  }
  return [...out, ...rest.filter((l) => l !== '').map((l) => `+ ${l}`)]
}

describe('launcher drift from resources/darwin/bin/orca', () => {
  it('bin/orca differs only in the Pilot executable and error text', () => {
    expect(diff(read('orca'))).toEqual([
      '- \techo "Unable to determine Orca.app path from symlink: ${BASH_SOURCE[0]}"',
      '- ELECTRON="$CONTENTS/MacOS/Orca"',
      '+ \techo "Unable to determine Pilot.app path from symlink: ${BASH_SOURCE[0]}"',
      '+ ELECTRON="$CONTENTS/MacOS/Pilot"'
    ])
  })

  it('bin/pilot adds only the data-folder export on top of bin/orca', () => {
    expect(diff(read('pilot')).filter((l) => !diff(read('orca')).includes(l))).toEqual([
      '+ export ORCA_USER_DATA_PATH="$HOME/Library/Application Support/Pilot"'
    ])
  })
})
