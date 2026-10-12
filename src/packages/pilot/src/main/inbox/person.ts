import type { ItemFields } from '../../shared/api-types'
import { personByGitlab, type PeopleDirectory } from '../../shared/people'
import { renderTemplate } from '../../shared/template'

// Contract §10: the automation's `inbox` template, rendered with the item's fields, names a person id, a
// group id, or a GitLab handle. A card that names nobody Pilot knows goes to the first person in
// people.yaml (routed: false, so the caller records it), so a card is never lost.
export function resolveInboxPerson(
  template: string,
  fields: ItemFields,
  people: PeopleDirectory
): { person: string; routed: boolean } {
  const rendered = renderTemplate(template, fields).text.trim()
  if (
    people.people.some((p) => p.id === rendered) ||
    people.groups.some((g) => g.id === rendered)
  ) {
    return { person: rendered, routed: true }
  }
  const byHandle = personByGitlab(people, rendered.replace(/^@/, ''))
  if (byHandle) {
    return { person: byHandle.id, routed: true }
  }
  return { person: people.people[0]?.id ?? rendered, routed: false }
}
