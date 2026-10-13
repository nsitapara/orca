import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { EventEmitter } from 'node:events'
import * as fs from 'node:fs'
import { describe, expect, it, vi } from 'vitest'
import { PilotStore } from '../store/store'
import {
  loadDefinitions,
  watchDefinitions,
  type DefinitionMemory,
  type LoadedDefinitions
} from './loader'

vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal<typeof fs>()
  return { ...actual, watch: vi.fn(actual.watch) }
})

const VALID =
  'name: A\nrepo: web-platform\nschedule: manual\nitems: { kind: merge_request }\nsteps: [ { agent: claude, prompt: hi } ]\n'
const PEOPLE =
  'people:\n  - { id: nish, name: Nish, gitlab: nish8 }\ngroups:\n  - { id: eng, name: Eng, members: [nish] }\n'

function withAuthor(author: string): string {
  return `name: A\nrepo: web-platform\nschedule: manual\nitems:\n  kind: merge_request\n  where:\n    author: ${author}\nsteps: [ { agent: claude, prompt: hi } ]\n`
}

function dir(files: Record<string, string> = {}): string {
  const d = mkdtempSync(join(tmpdir(), 'pilot-defs-'))
  for (const [name, text] of Object.entries(files)) {
    writeFileSync(join(d, name), text)
  }
  return d
}

describe('loadDefinitions', () => {
  it('loads valid files, keeps errors per file, and reads people.yaml', () => {
    const d = dir({
      'a.yaml': VALID,
      'broken.yaml': 'name: [',
      'people.yaml': 'people:\n  - { id: nish, name: Nish, gitlab: nish8 }\n',
      'notes.md': '# not an automation'
    })
    const loaded = loadDefinitions([d])
    expect(loaded.definitions.map((x) => x.id)).toEqual(['a'])
    expect(loaded.errors.map((e) => e.file)).toEqual([join(d, 'broken.yaml')])
    expect(loaded.people.people.map((p) => p.id)).toEqual(['nish'])
    expect(loaded.missingDirs).toEqual([])
  })

  it('reports missing folders without failing (Review Focus extra)', () => {
    const missing = join(tmpdir(), 'pilot-defs-does-not-exist')
    expect(loadDefinitions([missing])).toMatchObject({
      definitions: [],
      errors: [],
      missingDirs: [missing]
    })
  })

  it('reports the same automation id in two folders', () => {
    const a = dir({ 'x.yaml': VALID })
    const b = dir({ 'x.yaml': VALID })
    const loaded = loadDefinitions([a, b])
    expect(loaded.definitions).toHaveLength(1)
    expect(loaded.errors).toEqual([
      {
        file: join(b, 'x.yaml'),
        errors: [
          `${join(b, 'x.yaml')}: automation id "x" is already defined in ${join(a, 'x.yaml')}`
        ]
      }
    ])
  })
})

describe('loadDefinitions resilience', () => {
  it('does not throw on unreadable entries; valid files still load', () => {
    const d = dir({ 'a.yaml': VALID })
    mkdirSync(join(d, 'bad.yaml'))
    symlinkSync(join(d, 'nowhere'), join(d, 'gone.yaml'))
    const loaded = loadDefinitions([d])
    expect(loaded.definitions.map((x) => x.id)).toEqual(['a'])
    expect(loaded.errors.map((e) => e.file)).toEqual([join(d, 'bad.yaml'), join(d, 'gone.yaml')])
    expect(loaded.errors[0]?.errors[0]).toContain("couldn't read")
  })

  it('turns an unreadable people.yaml into peopleError', () => {
    const d = dir()
    symlinkSync(join(d, 'nowhere'), join(d, 'people.yaml'))
    expect(loadDefinitions([d]).peopleError).toContain("couldn't read")
  })

  it('turns a folder that is a file into one error entry', () => {
    const f = join(dir({ 'plain.txt': 'x' }), 'plain.txt')
    const loaded = loadDefinitions([f])
    expect(loaded.errors).toEqual([{ file: f, errors: [expect.stringContaining("couldn't list")] }])
  })

  it('skips hidden files, and never parses people.yml as an automation', () => {
    const d = dir({
      '.x.yaml': VALID,
      '._x.yaml': VALID,
      'people.yml': 'people:\n  - { id: nish, name: Nish }\n'
    })
    symlinkSync(join(d, 'nowhere'), join(d, '.#a.yaml'))
    const loaded = loadDefinitions([d])
    expect(loaded.definitions).toEqual([])
    expect(loaded.errors).toEqual([])
    expect(loaded.people.people.map((p) => p.id)).toEqual(['nish'])
  })

  it('people.yaml wins over people.yml and the conflict is noted', () => {
    const d = dir({
      'people.yaml': 'people:\n  - { id: a, name: A }\n',
      'people.yml': 'people:\n  - { id: b, name: B }\n'
    })
    const loaded = loadDefinitions([d])
    expect(loaded.people.people.map((p) => p.id)).toEqual(['a'])
    expect(loaded.peopleError).toContain('both exist')
  })
})

describe('people references', () => {
  const cases: { name: string; author: string; error: string | null }[] = [
    { name: 'known person', author: '{ people: [nish] }', error: null },
    { name: 'known group', author: '{ group: eng }', error: null },
    { name: 'anyone', author: 'anyone', error: null },
    {
      name: 'unknown person',
      author: '{ people: [nish, ghost] }',
      error: 'items.where.author: unknown person "ghost"'
    },
    {
      name: 'unknown person inside a not ref',
      author: '{ not: { people: [ghost] } }',
      error: 'items.where.author.not: unknown person "ghost"'
    },
    { name: 'known group inside a not ref', author: '{ not: { group: eng } }', error: null },
    {
      name: 'unknown group',
      author: '{ group: ops }',
      error: 'items.where.author: unknown group "ops"'
    }
  ]
  for (const c of cases) {
    it(`${c.name}`, () => {
      const d = dir({ 'a.yaml': withAuthor(c.author), 'people.yaml': PEOPLE })
      const loaded = loadDefinitions([d])
      const file = join(d, 'a.yaml')
      if (c.error === null) {
        expect(loaded.definitions.map((x) => x.id)).toEqual(['a'])
        expect(loaded.errors).toEqual([])
      } else {
        expect(loaded.definitions).toEqual([])
        expect(loaded.errors).toEqual([{ file, errors: [`${file}: ${c.error}`] }])
      }
    })
  }

  it('checks every where clause that names people, such as reviewer', () => {
    const yaml =
      'name: A\nrepo: web-platform\nschedule: manual\nitems:\n  kind: merge_request\n  where:\n    reviewer: { people: [ghost] }\n    approved_by: none\nsteps: [ { agent: claude, prompt: hi } ]\n'
    const d = dir({ 'a.yaml': yaml, 'people.yaml': PEOPLE })
    const file = join(d, 'a.yaml')
    expect(loadDefinitions([d]).errors).toEqual([
      { file, errors: [`${file}: items.where.reviewer: unknown person "ghost"`] }
    ])
  })

  it('an absent ref needs no people.yaml', () => {
    expect(loadDefinitions([dir({ 'a.yaml': VALID })]).definitions).toHaveLength(1)
  })

  it('reports both errors when people.yaml is broken and an automation has a group ref', () => {
    const d = dir({
      'a.yaml': withAuthor('{ group: eng }'),
      'people.yaml': 'people:\n  - { id: a, name: A }\n  - { id: a, name: B }\n'
    })
    const loaded = loadDefinitions([d])
    const file = join(d, 'a.yaml')
    expect(loaded.peopleError).toContain('duplicate person id: a')
    expect(loaded.definitions).toEqual([])
    expect(loaded.errors).toEqual([
      { file, errors: [`${file}: items.where.author: unknown group "eng"`] }
    ])
  })
})

describe('watchDefinitions', () => {
  // fs.watch can miss an event written the instant after it attaches, so keep
  // rewriting the file until a debounced callback sees it.
  function nextChange(d: string): Promise<LoadedDefinitions> {
    return new Promise((resolve, reject) => {
      let n = 0
      const stop = (): void => {
        clearTimeout(timeout)
        clearInterval(writer)
        close()
      }
      const timeout = setTimeout(() => {
        stop()
        reject(new Error('no change callback within 5s'))
      }, 5000)
      const close = watchDefinitions(
        [d],
        (loaded) => {
          // macOS can replay the folder's creation as a first event, so wait
          // for the callback that actually sees the file.
          if (loaded.definitions.length > 0) {
            stop()
            resolve(loaded)
          }
        },
        50
      )
      const writer = setInterval(() => writeFileSync(join(d, 'b.yaml'), `${VALID}# ${n++}\n`), 100)
    })
  }

  it('reloads after a file changes', async () => {
    const loaded = await nextChange(dir())
    expect(loaded.definitions.map((x) => x.id)).toEqual(['b'])
  })

  it('survives a watcher error event and a watch() that throws', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const emitter = Object.assign(new EventEmitter(), { close: vi.fn() })
    vi.mocked(fs.watch)
      .mockImplementationOnce(() => {
        throw new Error('EMFILE')
      })
      .mockImplementationOnce(() => emitter as unknown as fs.FSWatcher)
    const stop = watchDefinitions([dir(), dir()], () => {}, 10)
    expect(() => emitter.emit('error', new Error('ENOSPC'))).not.toThrow()
    expect(emitter.close).toHaveBeenCalled()
    expect(warn).toHaveBeenCalledTimes(2)
    stop()
    warn.mockRestore()
  })

  it('does not throw for a missing folder and still closes cleanly', () => {
    const stop = watchDefinitions([join(tmpdir(), 'pilot-defs-nope', 'x')], () => {}, 10)
    expect(() => stop()).not.toThrow()
  })
})

describe('the last valid version', () => {
  const memory = () => PilotStore.open(':memory:').definitions
  const at = (hour: number) => () => Date.UTC(2026, 9, 11, hour, 0)

  it('keeps the last valid version after a broken edit for display only, and says so (Review Focus)', () => {
    const d = dir({ 'a.yaml': VALID })
    const file = join(d, 'a.yaml')
    const mem = memory()
    loadDefinitions([d], mem, at(9))
    writeFileSync(file, `${VALID.replace('name: A', 'name: B')}onceper: x\n`)
    const loaded = loadDefinitions([d], mem, at(10))
    expect(loaded.definitions.map((x) => [x.id, x.name])).toEqual([['a', 'A']])
    expect(loaded.displayOnly).toEqual(['a'])
    expect(loaded.errors).toEqual([
      {
        file,
        errors: [
          `${file}: unknown key "onceper"`,
          `${file}: Pilot shows the last valid version, saved 2026-10-11T09:00:00.000Z; it isn't ticked until the file is valid again`
        ]
      }
    ])
  })

  it('runs the edit once it is valid again', () => {
    const d = dir({ 'a.yaml': VALID })
    const file = join(d, 'a.yaml')
    const mem = memory()
    loadDefinitions([d], mem)
    writeFileSync(file, 'name: [')
    loadDefinitions([d], mem)
    writeFileSync(file, VALID.replace('name: A', 'name: C'))
    const fixed = loadDefinitions([d], mem)
    expect(fixed.definitions.map((x) => x.name)).toEqual(['C'])
    expect(fixed.displayOnly).toEqual([])
  })

  it('has nothing to keep for a file that never loaded', () => {
    expect(loadDefinitions([dir({ 'a.yaml': 'name: [' })], memory()).definitions).toEqual([])
  })

  it('forgets a deleted file, so a broken copy added later has nothing to fall back on (Review Focus)', () => {
    const d = dir({ 'a.yaml': VALID })
    const mem = memory()
    loadDefinitions([d], mem)
    rmSync(join(d, 'a.yaml'))
    expect(loadDefinitions([d], mem).definitions).toEqual([])
    writeFileSync(join(d, 'a.yaml'), 'name: [')
    expect(loadDefinitions([d], mem).definitions).toEqual([])
  })

  it('keeps no version whose people no longer resolve', () => {
    const d = dir({ 'a.yaml': withAuthor('{ people: [nish] }'), 'people.yaml': PEOPLE })
    const mem = memory()
    loadDefinitions([d], mem)
    writeFileSync(join(d, 'a.yaml'), 'name: [')
    writeFileSync(join(d, 'people.yaml'), 'people:\n  - { id: emil, name: Emil }\n')
    expect(loadDefinitions([d], mem).definitions).toEqual([])
  })

  it('keeps nothing in place of a duplicate id', () => {
    const a = dir({ 'x.yaml': VALID })
    const b = dir({ 'x.yaml': VALID })
    const loaded = loadDefinitions([a, b], memory())
    expect(loaded.definitions.map((x) => x.file)).toEqual([join(a, 'x.yaml')])
    expect(loaded.errors.map((e) => e.errors.length)).toEqual([1])
  })

  it('remembers why a file failed', () => {
    const d = dir({ 'a.yaml': 'name: [' })
    const mem = memory()
    loadDefinitions([d], mem, () => 5)
    expect(mem.errors()).toEqual([
      { id: 'a', file: join(d, 'a.yaml'), errors: [expect.stringContaining('YAML error')], at: 5 }
    ])
  })

  it('still loads every valid file when the memory fails', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const broken = (): never => {
      throw new Error('database is closed')
    }
    const failing: DefinitionMemory = {
      lastValid: broken,
      saveValid: broken,
      saveErrors: broken,
      forgetAllBut: broken
    }
    const d = dir({ 'a.yaml': VALID, 'b.yaml': 'name: [' })
    const loaded = loadDefinitions([d], failing)
    expect(loaded.definitions.map((x) => x.id)).toEqual(['a'])
    expect(loaded.errors.map((e) => e.file)).toEqual([join(d, 'b.yaml')])
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('database is closed'))
    warn.mockRestore()
  })
})

describe('jobs of several automations', () => {
  const memory = () => PilotStore.open(':memory:').definitions
  const at = (hour: number) => () => Date.UTC(2026, 9, 11, hour, 0)
  const STAGE_1 =
    'job: { id: "13", name: Fix red e2e, stage: 1, label: Open the ticket, feeds: b, hands_over: its tickets }\n'
  const stageOf = (n: number) => `job: { id: "13", stage: ${n}, label: Start fixes }\n`

  it('loads the stages of a job that keeps the rules', () => {
    const d = dir({ 'a.yaml': VALID + STAGE_1, 'b.yaml': VALID + stageOf(2) })
    const loaded = loadDefinitions([d])
    expect(loaded.errors).toEqual([])
    expect(loaded.definitions.map((x) => [x.id, x.job?.stage])).toEqual([
      ['a', 1],
      ['b', 2]
    ])
  })

  it('marks every definition a broken rule involves invalid, keeping each one’s last valid version for display', () => {
    const d = dir({ 'a.yaml': VALID + STAGE_1, 'b.yaml': VALID + stageOf(2) })
    const mem = memory()
    loadDefinitions([d], mem, at(9))
    writeFileSync(join(d, 'b.yaml'), VALID + stageOf(1))
    const loaded = loadDefinitions([d], mem, at(10))
    expect(loaded.definitions.map((x) => [x.id, x.job?.stage])).toEqual([
      ['a', 1],
      ['b', 2]
    ])
    expect(loaded.displayOnly).toEqual(['a', 'b'])
    const kept = (file: string) =>
      `${join(d, file)}: Pilot shows the last valid version, saved 2026-10-11T09:00:00.000Z; it isn't ticked until the file is valid again`
    expect(loaded.errors).toEqual([
      {
        file: join(d, 'a.yaml'),
        errors: [`${join(d, 'a.yaml')}: job 13: stage 1 is set by both a and b`, kept('a.yaml')]
      },
      {
        file: join(d, 'b.yaml'),
        errors: [`${join(d, 'b.yaml')}: job 13: stage 1 is set by both a and b`, kept('b.yaml')]
      }
    ])
    // The refused version was never saved as valid: fixing the file runs the fix, breaking it again keeps stage 2.
    writeFileSync(join(d, 'b.yaml'), 'name: [')
    const broken = loadDefinitions([d], mem, at(11))
    expect(broken.definitions.map((x) => [x.id, x.job?.stage])).toEqual([
      ['a', 1],
      ['b', 2]
    ])
    expect(broken.displayOnly).toEqual(['b'])
  })

  it('refuses an involved definition that never loaded validly, and leaves the rest alone', () => {
    const d = dir({ 'a.yaml': VALID + STAGE_1.replace('feeds: b', 'feeds: c'), 'z.yaml': VALID })
    const loaded = loadDefinitions([d], memory())
    expect(loaded.definitions.map((x) => x.id)).toEqual(['z'])
    expect(loaded.errors).toEqual([
      { file: join(d, 'a.yaml'), errors: [`${join(d, 'a.yaml')}: job.feeds: no automation "c"`] }
    ])
  })
})
