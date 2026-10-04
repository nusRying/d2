// Slice 47 — routing context polling.
//
// Pinned reference: d2layouts/d2talalayout/internal/routing/work.go
// (cachedContextErr; chargeSkippedRouteWork lives with routeSearchWorkGuard
// in route-search-guard.js).

/**
 * contextDone models Go's `ctx.Done()` channel. Contexts that expose a
 * non-Err completion probe (`doneAvailable` + `isCancelled`) return that probe;
 * all others (Background-like contexts, Err-only counting contexts) return
 * null, matching a nil Done channel.
 */
export function contextDone(ctx) {
  if (ctx != null && ctx.doneAvailable === true && typeof ctx.isCancelled === 'function') {
    return () => ctx.isCancelled();
  }
  return null;
}

/**
 * cachedContextErr: with a nil Done channel every poll calls ctx.Err(); with a
 * Done channel ctx.Err() is consulted only once Done has closed.
 */
export function cachedContextErr(ctx, done) {
  if (done == null) {
    return ctx.Err();
  }
  if (done()) {
    return ctx.Err();
  }
  return null;
}
