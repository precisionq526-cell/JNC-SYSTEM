/** PostgREST returns a unique foreign-key relationship as an object, and a to-many relationship as an array. */
export function relationList<T>(value: T | T[] | null | undefined): T[] {
  return value == null ? [] : Array.isArray(value) ? value : [value]
}
export function firstRelation<T>(value: T | T[] | null | undefined): T | null {
  return relationList(value)[0] ?? null
}
