import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { parseAutomationYaml } from '../../shared/definition/parse'
import { modeTextFor, readFirstFile, readMode, skillSearchDirs } from './modes'

function writeMode(root: string, skill: string, mode: string, text: string): string {
  const dir = join(root, skill, 'modes')
  mkdirSync(dir, { recursive: true })
  const file = join(dir, `${mode}.md`)
  writeFileSync(file, text)
  return file
}

function setup() {
  const home = mkdtempSync(join(tmpdir(), 'pilot-modes-home-'))
  const workspace = mkdtempSync(join(tmpdir(), 'pilot-modes-ws-'))
  return { home, workspace }
}

describe('readMode', () => {
  it("prefers the workspace's own skill over the home store", () => {
    const { home, workspace } = setup()
    writeMode(join(home, '.agents', 'skills'), 'ui-qa', 'test', 'home body')
    const file = writeMode(
      join(workspace, '.claude', 'skills'),
      'ui-qa',
      'test',
      '---\noutputs: [found_bugs]\n---\nproject body'
    )
    expect(readMode('ui-qa', 'test', workspace, home)).toEqual({
      skill: 'ui-qa',
      mode: 'test',
      file,
      outputs: ['found_bugs'],
      inputs: null,
      description: null,
      body: 'project body'
    })
  })

  it('falls back to ~/.agents/skills without a workspace', () => {
    const { home } = setup()
    writeMode(join(home, '.agents', 'skills'), 'fix-gitlab-ci', 'answers', 'Apply the answer.')
    expect(readMode('fix-gitlab-ci', 'answers', null, home).body).toBe('Apply the answer.')
  })

  it('names every place it looked when the mode is missing', () => {
    const { home, workspace } = setup()
    expect(() => readMode('ui-qa', 'fix', workspace, home)).toThrow(
      [
        'Mode "fix" of skill "ui-qa" not found; looked in:',
        ...skillSearchDirs(workspace, home).map((d) => `  ${join(d, 'ui-qa', 'modes', 'fix.md')}`)
      ].join('\n')
    )
  })

  it.each([
    ['../ui-qa', 'test'],
    ['ui-qa', '../../etc/passwd']
  ])('refuses the names %s / %s', (skill, mode) => {
    const { home } = setup()
    expect(() => readMode(skill, mode, null, home)).toThrow(
      'names may use letters, digits, ., _ and - only'
    )
  })

  it("surfaces a mode file's frontmatter error", () => {
    const { home } = setup()
    writeMode(join(home, '.agents', 'skills'), 'ui-qa', 'test', '---\noutput: [x]\n---\nbody')
    expect(() => readMode('ui-qa', 'test', null, home)).toThrow('unknown frontmatter key "output"')
  })
})

describe('readFirstFile', () => {
  it('skips a missing file or one under a file, reads the first there, and names why one exists but is unreadable', () => {
    const { home } = setup()
    const file = join(home, 'ticket.md')
    writeFileSync(file, 'body')
    const dir = join(home, 'a-folder')
    mkdirSync(dir)
    expect(readFirstFile([join(home, 'gone.md'), join(file, 'under.md'), file])).toEqual({
      file,
      text: 'body'
    })
    expect(readFirstFile([join(home, 'gone.md')])).toBeNull()
    expect(() => readFirstFile([dir, file])).toThrow(`Can't read ${dir}: EISDIR`)
  })
})

describe('modeTextFor', () => {
  const stepOf = (step: string) => {
    const p = parseAutomationYaml(
      `name: Review\nrepo: web-platform\nschedule: manual\nsteps:\n  - ${step}\n`,
      '/a/review.yaml'
    )
    if (!p.ok) {
      throw new Error(p.errors.join('\n'))
    }
    return p.definition.steps[0]
  }
  const read = vi.fn(() => ({ body: 'Review the interval.' }))

  it.each([
    ['no mode', '{ name: review, agent: claude, skill: review-cycles, prompt: Go }', null],
    [
      'a raw prompt',
      '{ name: review, agent: claude, skill: review-cycles, mode: review, prompt: /review, prompt_style: raw }',
      null
    ],
    [
      'a mode',
      '{ name: review, agent: claude, skill: review-cycles, mode: review }',
      'Review the interval.'
    ]
  ])('gives %s → %j', async (_n, step, text) => {
    expect(await modeTextFor(read)(stepOf(step), '/wt')).toBe(text)
  })

  it('reads the mode from the workspace the step launches in', async () => {
    read.mockClear()
    await modeTextFor(read)(
      stepOf('{ name: review, agent: claude, skill: review-cycles, mode: review }'),
      '/wt'
    )
    expect(read).toHaveBeenCalledWith('review-cycles', 'review', '/wt')
  })

  it('rejects a mode of a step with no skill, naming the step', async () => {
    // The YAML parser already refuses this file; the reader still guards a step built another way.
    const step = {
      ...stepOf('{ name: review, agent: claude, skill: review-cycles, mode: review }'),
      skill: null
    }
    await expect(modeTextFor(read)(step, '/wt')).rejects.toThrow(
      'Step review: mode "review" needs a skill'
    )
  })
})
