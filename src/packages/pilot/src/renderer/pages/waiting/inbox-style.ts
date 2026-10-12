import { createElement } from 'react'

// The Agent Console's colour tokens (worktree-gate/assets/answers.html), scoped to the page so no upstream
// theme variable changes. Light values by default; Pilot's theme class is `.dark` on the root.
export const INBOX_CSS = `
.pilot-inbox{--ib-accent:#1e5ad6;--ib-accent-fg:#eff1f5;--ib-accent-soft:#d4ddf1;--ib-ok:#2b7a1c;--ib-ok-soft:#d6e2d9;--ib-warn:#8a5a06;--ib-warn-soft:#e2ddd6;--ib-bad:#b80d33;--ib-bad-soft:#e8d3dc}
.dark .pilot-inbox{--ib-accent:#89b4fa;--ib-accent-fg:#11111b;--ib-accent-soft:#303851;--ib-ok:#a6e3a1;--ib-ok-soft:#353f42;--ib-warn:#f9e2af;--ib-warn-soft:#433f44;--ib-bad:#f38ba8;--ib-bad-soft:#423143}
`

export function InboxStyle(): React.JSX.Element {
  return createElement('style', { 'data-pilot-inbox': '' }, INBOX_CSS)
}
