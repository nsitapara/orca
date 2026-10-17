import { describe, expect, it } from 'vitest'
import { actionButton } from './answer-actions'

describe('actionButton', () => {
  it.each([
    ['push', 'Push to origin', 'Pushing…'],
    ['mark_ready', 'Mark ready', 'Marking ready…'],
    ['linear_create', 'Create ticket', 'Creating ticket…'],
    ['linear_comment', 'Comment on ticket', 'Commenting…'],
    ['linear_set_state', 'Update ticket', 'Updating ticket…'],
    ['linear_attach', 'Attach to ticket', 'Attaching…'],
    ['something_new', 'Approve', 'Applying…'],
    [null, 'Approve', 'Applying…']
  ])('names %s', (action, label, doing) => {
    expect(actionButton(action)).toEqual({ label, doing })
  })
})
