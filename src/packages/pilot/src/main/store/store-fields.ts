import type Database from '../../../../../main/sqlite/sync-database'
import type { FieldValue } from '../../shared/api-types'

// Custom field values (contract §5): one row per automation, field and item (A7), tagged with the
// cache key it was computed under: the pass id (per_tick) or the head (per_head).
export class FieldCacheStore {
  constructor(private readonly db: Database) {}

  get(
    automationId: string,
    field: string,
    itemKey: string,
    cacheKey: string
  ): { value: FieldValue; at: number } | null {
    const r = this.db
      .prepare(
        'SELECT cache_key, value_json, at FROM field_cache WHERE automation_id = ? AND field = ? AND item_key = ?'
      )
      .get(automationId, field, itemKey)
    // The row is the item's latest value; a different cache key (a newer pass or head) makes it a miss.
    if (!r || r.cache_key !== cacheKey) {
      return null
    }
    return { value: JSON.parse(String(r.value_json)) as FieldValue, at: Number(r.at) }
  }

  // The primary key is (automation, field, item): a new cache key (the next pass, a new head)
  // replaces the old value, so per_tick values never pile up a row per pass.
  set(
    automationId: string,
    field: string,
    itemKey: string,
    cacheKey: string,
    value: FieldValue,
    at: number
  ): void {
    this.db
      .prepare(
        'INSERT OR REPLACE INTO field_cache (automation_id, field, item_key, cache_key, value_json, at) VALUES (?, ?, ?, ?, ?, ?)'
      )
      .run(automationId, field, itemKey, cacheKey, JSON.stringify(value), at)
  }
}
