import { describe, expect, it } from 'vitest'
import { parseAutomationYaml } from '../../shared/definition/parse'
import { PilotStore } from './store'

const YAML =
  'name: A\nrepo: web-platform\nschedule: manual\nitems: { kind: merge_request }\nsteps: [ { agent: claude, prompt: hi } ]\n'

function definitionOf(yaml: string, file = '/a/a.yaml') {
  const parsed = parseAutomationYaml(yaml, file)
  if (!parsed.ok) {
    throw new Error(parsed.errors.join('\n'))
  }
  return parsed.definition
}

describe('DefinitionStore', () => {
  it('keeps the last valid version, and since when it has run unchanged', () => {
    const { definitions } = PilotStore.open(':memory:')
    expect(definitions.lastValid('a')).toBeNull()
    definitions.saveValid(definitionOf(YAML), YAML, 100)
    definitions.saveValid(definitionOf(YAML), YAML, 200)
    expect(definitions.lastValid('a')).toEqual({
      id: 'a',
      file: '/a/a.yaml',
      yaml: YAML,
      loadedAt: 100
    })
    const edited = YAML.replace('name: A', 'name: B')
    definitions.saveValid(definitionOf(edited), edited, 300)
    expect(definitions.lastValid('a')).toEqual({
      id: 'a',
      file: '/a/a.yaml',
      yaml: edited,
      loadedAt: 300
    })
  })

  it('remembers why a file failed until a valid version of it loads', () => {
    const { definitions } = PilotStore.open(':memory:')
    definitions.saveErrors('a', '/a/a.yaml', ['/a/a.yaml: unknown key "x"'], 50)
    expect(definitions.errors()).toEqual([
      { id: 'a', file: '/a/a.yaml', errors: ['/a/a.yaml: unknown key "x"'], at: 50 }
    ])
    definitions.saveValid(definitionOf(YAML), YAML, 60)
    expect(definitions.errors()).toEqual([])
  })

  it('forgets every automation whose file is gone', () => {
    const { definitions } = PilotStore.open(':memory:')
    definitions.saveValid(definitionOf(YAML), YAML, 1)
    definitions.saveValid(definitionOf(YAML, '/a/b.yaml'), YAML, 1)
    definitions.saveErrors('c', '/a/c.yaml', ['bad'], 1)
    definitions.forgetAllBut(['b'])
    expect(definitions.lastValid('a')).toBeNull()
    expect(definitions.lastValid('b')?.file).toBe('/a/b.yaml')
    expect(definitions.errors()).toEqual([])
  })
})
