import { describe, expect, it } from 'vitest'
import { parseAutomationYaml } from '../../shared/definition/parse'
import { EMPTY_PEOPLE } from '../../shared/people'
import { liveDefinitions } from './live'
import type { LoadedDefinitions } from './loader'

function loaded(ids: string[], extra: Partial<LoadedDefinitions> = {}): LoadedDefinitions {
  const definitions = ids.map((id) => {
    const r = parseAutomationYaml(
      `name: ${id}\nrepo: r\nschedule: manual\nsteps: [ { agent: claude, prompt: x } ]\n`,
      `/a/${id}.yaml`
    )
    if (!r.ok) {
      throw new Error(r.errors.join('\n'))
    }
    return r.definition
  })
  return {
    definitions,
    errors: [],
    people: EMPTY_PEOPLE,
    peopleError: null,
    missingDirs: [],
    ...extra
  }
}

function harness(first: LoadedDefinitions) {
  const logs: string[] = []
  let onChange: (next: LoadedDefinitions) => void = () => {}
  let next = first
  let closed = 0
  const live = liveDefinitions(['/a'], (m) => logs.push(m), {
    load: () => next,
    watch: (_dirs, cb) => {
      onChange = cb
      return () => {
        closed += 1
      }
    }
  })
  return {
    live,
    logs,
    fire: (l: LoadedDefinitions) => onChange(l),
    setNext: (l: LoadedDefinitions) => (next = l),
    closed: () => closed
  }
}

describe('liveDefinitions', () => {
  it('loads every automation when people.yaml has a problem, and reports it as a note', () => {
    const note = '/a/people.yaml: people.yaml and people.yml both exist; using people.yaml'
    const h = harness(loaded(['ci'], { peopleError: note }))
    expect(h.live.current().definitions.map((d) => d.id)).toEqual(['ci'])
    expect(h.logs).toEqual([`[pilot] people: ${note}`])
  })

  it('applies a watched change and logs it, but a reload with the same content changes nothing', () => {
    const h = harness(loaded(['ci']))
    const before = h.live.current()
    h.fire(loaded(['ci']))
    expect(h.live.current()).toBe(before)
    expect(h.logs).toEqual([])
    h.fire(
      loaded(['ci', 'deploy'], { errors: [{ file: '/a/x.yaml', errors: ['/a/x.yaml: bad'] }] })
    )
    expect(h.live.current().definitions.map((d) => d.id)).toEqual(['ci', 'deploy'])
    expect(h.logs).toEqual([
      '[pilot] automations reloaded: 2 automation(s)',
      '[pilot] /a/x.yaml: bad'
    ])
  })

  it('logs a reload that throws and keeps the last good definitions (T16→T20)', () => {
    const h = harness(loaded(['ci']))
    const broken = Object.defineProperty({}, 'definitions', {
      enumerable: true,
      get() {
        throw new Error('boom')
      }
    }) as LoadedDefinitions
    expect(() => h.fire(broken)).not.toThrow()
    expect(h.live.current().definitions.map((d) => d.id)).toEqual(['ci'])
    expect(h.logs).toEqual(["[pilot] couldn't apply reloaded automations: boom"])
  })

  it('reloads on demand and stops watching once', () => {
    const h = harness(loaded([]))
    h.setNext(loaded(['ci']))
    expect(h.live.reload().definitions.map((d) => d.id)).toEqual(['ci'])
    h.live.stop()
    h.live.stop()
    expect(h.closed()).toBe(1)
  })
})
