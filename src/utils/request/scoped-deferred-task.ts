/**
 * Shared primitives behind the two translation queues (BatchQueue and
 * RequestQueue): deferred creation, the in-flight dedup map that releases on
 * settlement, and the refcounted cancellation-scope bookkeeping both queues
 * duplicate. The scope contract is the same everywhere: `null` means an
 * unscoped subscriber exists and pins the task as uncancellable; otherwise the
 * task is cancelled only when its LAST scope is cancelled (dedup attaches one
 * scope per subscribing tab/session, #1881).
 */

export interface Deferred<T> {
  promise: Promise<T>
  resolve: (value: T) => void
  reject: (error: Error) => void
}

/** A promise with its settle functions exposed, for a task resolved later. */
export function createDeferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void
  let reject!: (error: Error) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

export interface InFlightEntry<TTask, TPromise = unknown> {
  task: TTask
  promise: Promise<TPromise>
}

/**
 * Dedup map for in-flight tasks: the first enqueue under a key registers here
 * and later enqueues with the same key join the registered promise instead of
 * issuing a duplicate request. Entries self-release when the registered
 * promise settles; the identity check keeps a late release from evicting a
 * newer registration that reused the key.
 */
export class InFlightTaskMap<TKey, TTask, TPromise = unknown> {
  private entries = new Map<TKey, InFlightEntry<TTask, TPromise>>()

  get(key: TKey): InFlightEntry<TTask, TPromise> | undefined {
    return this.entries.get(key)
  }

  register(key: TKey, task: TTask, promise: Promise<TPromise>): void {
    this.entries.set(key, { task, promise })
    const release = () => {
      if (this.entries.get(key)?.promise === promise) {
        this.entries.delete(key)
      }
    }
    promise.then(release, release)
  }
}

/**
 * Merge a joining subscriber's scopes into a task's scope set (the dedup
 * path: a second enqueue for the same key joins the first task). An unscoped
 * subscriber pins the task, and a task that is already pinned stays pinned;
 * otherwise every joined scope is added.
 */
export function joinTaskScopes(
  cancelScopes: Set<string> | null,
  scopes: readonly string[] | undefined,
): Set<string> | null {
  if (!scopes || scopes.length === 0) {
    return null
  }
  if (cancelScopes === null) {
    return null
  }
  for (const scope of scopes) {
    cancelScopes.add(scope)
  }
  return cancelScopes
}

/**
 * Remove every scope matching the predicate from the task's scope set.
 * Returns the last matched scope when this cancellation COMPLETES the task —
 * it had at least one match and none survive — or undefined when the task
 * survives (unpinned, no match, or scopes left).
 */
export function detachMatchingTaskScopes(
  cancelScopes: Set<string> | null,
  scopeMatches: (scopeKey: string) => boolean,
): string | undefined {
  if (cancelScopes === null) {
    return undefined
  }
  let matchedScope: string | undefined
  for (const scope of cancelScopes) {
    if (scopeMatches(scope)) {
      matchedScope = scope
      cancelScopes.delete(scope)
    }
  }
  if (matchedScope === undefined || cancelScopes.size > 0) {
    return undefined
  }
  return matchedScope
}
