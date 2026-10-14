import { existsSync } from 'node:fs'
import { mkdtemp, rm } from 'node:fs/promises'
import { afterEach, describe, expect, it } from 'vitest'
import { orphanedSidecars, sweepLeakedSidecars } from './orcad-sidecar-sweep'

const SERVE = '/Applications/Orca.app/Contents/MacOS/Orca --serve --serve-port 52422 --serve-json'

describe('orphanedSidecars', () => {
  it.each([
    [
      'an orphan on a /tmp profile',
      `  59225     1 ${SERVE} --user-data-dir=/tmp/orcad-browser-he1dQk`,
      [59225]
    ],
    [
      'an orphan on a /private/tmp profile',
      `6005 1 ${SERVE} --user-data-dir=/private/tmp/orcad-browser-VdkqLe`,
      [6005]
    ],
    [
      'one whose orcad is still running',
      `59225 4242 ${SERVE} --user-data-dir=/tmp/orcad-browser-he1dQk`,
      []
    ],
    ['the desktop app', '11625 1 /Applications/Orca.app/Contents/MacOS/Orca', []],
    [
      'a helper on the profile',
      '59503 1 crashpad_handler --database=/tmp/orcad-browser-he1dQk/Crashpad',
      []
    ],
    ['serve on another profile', `7000 1 ${SERVE} --user-data-dir=/tmp/orca-profile-he1dQk`, []]
  ])('%s', (_case, line, pids) => {
    expect(orphanedSidecars(line).map((sidecar) => sidecar.pid)).toEqual(pids)
  })
})

describe('sweepLeakedSidecars', () => {
  const dirs: string[] = []
  afterEach(async () => {
    await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })))
  })

  it('stops only orphans Vitest started and removes their profiles', async () => {
    for (let i = 0; i < 3; i++) {
      dirs.push(await mkdtemp('/tmp/orcad-browser-'))
    }
    const [darwinEnv, linuxEnv, production] = dirs
    const environments: Record<number, string> = {
      1: `${SERVE} --user-data-dir=${darwinEnv} TEST=true ORCA_VITEST_RUNTIME=node HOME=/Users/x`,
      2: 'TEST=true\0ORCA_VITEST_RUNTIME=bun\0HOME=/home/x\0',
      3: `${SERVE} --user-data-dir=${production} HOME=/Users/x`
    }
    const stopped: number[] = []

    const count = await sweepLeakedSidecars({
      list: async () =>
        [
          `1 1 ${SERVE} --user-data-dir=${darwinEnv}`,
          `2 1 ${SERVE} --user-data-dir=${linuxEnv}`,
          `3 1 ${SERVE} --user-data-dir=${production}`
        ].join('\n'),
      environment: async (pid) => environments[pid] ?? '',
      stop: async (pid) => {
        stopped.push(pid)
      }
    })

    expect(count).toBe(2)
    expect(stopped).toEqual([1, 2])
    expect(dirs.map((dir) => existsSync(dir))).toEqual([false, false, true])
  })
})
