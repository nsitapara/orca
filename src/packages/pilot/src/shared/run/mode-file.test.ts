import { describe, expect, it } from 'vitest'
import { parseModeFile } from './mode-file'

const FILE = '/s/review-cycles/modes/review.md'

describe('parseModeFile', () => {
  it.each([
    [
      'a file without frontmatter is all body',
      'Review the interval.\n',
      { outputs: null, inputs: null, description: null, body: 'Review the interval.' }
    ],
    [
      'reads outputs, inputs and description',
      '---\noutputs: [changed, report]\ninputs: [since]\ndescription: One review round\n---\nReview, then run `pilot run output changed=<true|false>`.\n',
      {
        outputs: ['changed', 'report'],
        inputs: ['since'],
        description: 'One review round',
        body: 'Review, then run `pilot run output changed=<true|false>`.'
      }
    ],
    [
      'an empty frontmatter declares nothing',
      '---\n---\nBody\n',
      { outputs: null, inputs: null, description: null, body: 'Body' }
    ],
    [
      'outputs: [] declares that the step reports none',
      '---\noutputs: []\n---\nBody\n',
      { outputs: [], inputs: null, description: null, body: 'Body' }
    ]
  ])('%s', (_n, text, mode) => expect(parseModeFile(text, FILE)).toEqual({ ok: true, mode }))

  it.each([
    [
      'an unknown key, named',
      '---\noutput: [changed]\n---\nx',
      `${FILE}: unknown frontmatter key "output" (allowed: outputs, inputs, description)`
    ],
    [
      'outputs that are not a list',
      '---\noutputs: changed\n---\nx',
      `${FILE}: outputs must be a list of names`
    ],
    [
      'an output name templates cannot read',
      '---\noutputs: [found-bugs]\n---\nx',
      `${FILE}: outputs: "found-bugs" isn't an output name: letters, digits and _, not starting with a digit`
    ],
    [
      'frontmatter that is not YAML',
      '---\noutputs: [a\n---\nx',
      expect.stringMatching(new RegExp(`^${FILE}: frontmatter isn't valid YAML: `))
    ]
  ])('refuses %s', (_n, text, error) =>
    expect(parseModeFile(text, FILE)).toEqual({ ok: false, error })
  )
})
