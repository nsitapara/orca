// Pilot's sidebar appearance setting styles both sidebars (hook right-sidebar-appearance), so its English
// labels drop "left". Exact strings only: other text about the left sidebar still means that one.
const LABELS = new Map([
  ['Left Sidebar Appearance', 'Sidebar Appearance'],
  [
    'Make the left sidebar match your terminal, stay default, or use a tint.',
    'Make both sidebars match your terminal, stay default, or use a tint.'
  ],
  ['The color mixed into the left sidebar surface.', 'The color mixed into both sidebar surfaces.'],
  [
    'Controls how strongly the tint is mixed into the sidebar.',
    'Controls how strongly the tint is mixed into the sidebars.'
  ]
])

export function pilotSidebarAppearanceLabel(text: string): string {
  return LABELS.get(text) ?? text
}
