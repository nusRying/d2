/**
 * Browser-safe work cancellation contexts.
 *
 * Pinned reference: d2layouts/d2talalayout/internal/limits/work.go
 */

export class WorkContext {
  /**
   * @param {Object} options
   * @param {() => boolean} [options.isCancelled]
   * @param {boolean} [options.doneAvailable]
   */
  constructor({ isCancelled = () => false, doneAvailable = false } = {}) {
    this._isCancelled = typeof isCancelled === "function" ? isCancelled : () => Boolean(isCancelled);
    this.doneAvailable = Boolean(doneAvailable);
  }

  isCancelled() {
    return this._isCancelled();
  }
}

/**
 * Creates a non-cancellable background work context.
 * Corresponds to Go context.Background().
 * doneAvailable = false, stride = 64.
 */
export function backgroundWorkContext() {
  return new WorkContext({
    isCancelled: () => false,
    doneAvailable: false,
  });
}

export const BackgroundWorkContext = backgroundWorkContext;

/**
 * Creates an AbortSignal-backed work context.
 * doneAvailable = true, stride = 1024.
 *
 * @param {AbortSignal} signal
 */
export function abortSignalWorkContext(signal) {
  if (!signal || typeof signal.aborted !== "boolean") {
    throw new TypeError("abortSignalWorkContext requires an AbortSignal");
  }
  return new WorkContext({
    isCancelled: () => signal.aborted,
    doneAvailable: true,
  });
}

export const AbortSignalWorkContext = abortSignalWorkContext;

/**
 * Creates a synthetic polling work context for Go parity testing.
 * doneAvailable = false, stride = 64.
 *
 * @param {(() => boolean) | boolean} isCancelled
 */
export function pollingWorkContext(isCancelled) {
  const check = typeof isCancelled === "function" ? isCancelled : () => Boolean(isCancelled);
  return new WorkContext({
    isCancelled: check,
    doneAvailable: false,
  });
}

export const PollingWorkContext = pollingWorkContext;
