import type { NonInsertProps, Table } from "dexie"

/**
 * The three table operations the helpers need, declared structurally: Dexie's
 * `EntityTable` generics (`IDType`, `InsertType`) stay conditional over an
 * unresolved record type, which a generic helper cannot call through.
 */
interface CacheTableBase {
  get(key: string): Promise<unknown>
  put(item: unknown): Promise<unknown>
  delete(key: string): Promise<unknown>
}

/**
 * The record type of a cache table, taken from the `Table` type argument:
 * inferring through the overloaded `get` return type loses the candidate.
 */
type CacheRecord<TTable> =
  TTable extends Table<infer Rec, infer _TKey, infer _TInsert> ? Rec : never

type CacheInsert<TTable> = Omit<
  CacheRecord<TTable>,
  "createdAt" | NonInsertProps<CacheRecord<TTable>>
>

/**
 * Get the cached value at `key`, or `undefined` when the entry is missing or
 * fails `validate` — a failing entry is deleted first, so one malformed record
 * cannot pin itself in front of regeneration on every later attempt. A
 * `validate` that throws propagates and leaves the entry alone, for checks
 * whose failure says something about the request, not the record.
 */
export async function getCachedValue<TTable extends CacheTableBase, Value>(
  table: TTable,
  key: string,
  toValue: (record: CacheRecord<TTable>) => Value,
  validate?: (value: Value) => boolean,
): Promise<Value | undefined> {
  const record = await table.get(key)
  if (!record) return undefined
  const value = toValue(record as CacheRecord<TTable>)
  if (!validate || validate(value)) return value
  await table.delete(key)
  return undefined
}

/**
 * The write side of `getCachedValue`: stamps `createdAt` and puts the entry.
 * The record classes carry an `Entity`-provided `table` method that Dexie
 * assigns at runtime, so the stored object is assembled without it.
 */
export function putCachedValue<TTable extends CacheTableBase>(
  table: TTable,
  value: CacheInsert<TTable>,
): Promise<unknown> {
  return table.put({ ...value, createdAt: new Date() } as CacheRecord<TTable>)
}
