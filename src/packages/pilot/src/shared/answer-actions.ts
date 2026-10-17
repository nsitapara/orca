// What the one-click button of an action card says it does, and what the card says while it runs. Keyed by the
// catalog's action names (main/actions); an action not named here is a plain "Approve". Display only: what an
// action runs is the catalog's.
type ActionButton = { label: string; doing: string }

const ACTION_BUTTONS: Record<string, ActionButton> = {
  push: { label: 'Push to origin', doing: 'Pushing…' },
  mark_ready: { label: 'Mark ready', doing: 'Marking ready…' },
  linear_create: { label: 'Create ticket', doing: 'Creating ticket…' },
  linear_comment: { label: 'Comment on ticket', doing: 'Commenting…' },
  linear_set_state: { label: 'Update ticket', doing: 'Updating ticket…' },
  linear_attach: { label: 'Attach to ticket', doing: 'Attaching…' }
}
const UNKNOWN: ActionButton = { label: 'Approve', doing: 'Applying…' }

export function actionButton(action: string | null | undefined): ActionButton {
  return (action ? ACTION_BUTTONS[action] : undefined) ?? UNKNOWN
}
