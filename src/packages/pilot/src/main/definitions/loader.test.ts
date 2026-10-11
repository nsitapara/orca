import { mkdirSync, mkdtempSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { EventEmitter } from 'node:events'
import * as fs from 'node:fs'
import { describe, expect, it, vi } from 'vitest'
import { loadDefinitions, watchDefinitions, type LoadedDefinitions } from './loader'

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
