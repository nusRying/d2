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

  /**
   * Err returns null until cancellation, then the same error on every call
   * (Go context.Canceled identity).
   */
  Err() {
    if (!this.isCancelled()) return null;
    if (this._canceledError == null) {
      this._canceledError = new Error('context canceled');
    }
    return this._canceledError;
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

/**
 * Extracts any error from a context or signal.
 */
export function getContextError(ctx) {
  if (ctx == null) return null;
  if (typeof ctx.Err === "function") {
    return ctx.Err();
  }
  if (typeof ctx.isCancelled === "function") {
    return ctx.isCancelled() ? new Error("context canceled") : null;
  }
  const signal = typeof ctx.aborted === "boolean" ? ctx : ctx.signal;
  if (signal && typeof signal.aborted === "boolean") {
    if (signal.aborted) {
      const reason = signal.reason;
      if (reason instanceof Error) return reason;
      if (typeof reason === "string") return new Error(reason);
      return new Error("context canceled");
    }
    return null;
  }
  return null;
}

export const GetContextError = getContextError;

/**
 * Normalizes an incoming context into a canonical object exposing Err() -> Error | null.
 */
export function canonicalContext(ctx, location = "") {
  if (ctx == null) {
    throw new Error(`TALA ${location} requires a context`);
  }
  if (typeof ctx === "object" || typeof ctx === "function") {
    // A. If input already has Err(): use that exact Err() method.
    if (typeof ctx.Err === "function") {
      return {
        Err: () => ctx.Err(),
      };
    }
    // B. If input is WorkContext / only has isCancelled():
    if (typeof ctx.isCancelled === "function") {
      return {
        Err: () => (ctx.isCancelled() ? new Error("context canceled") : null),
      };
    }
    // C. AbortSignal or object with signal:
    const signal = typeof ctx.aborted === "boolean" ? ctx : ctx.signal;
    if (signal && typeof signal.aborted === "boolean") {
      return {
        Err: () => {
          if (signal.aborted) {
            const reason = signal.reason;
            if (reason instanceof Error) return reason;
            if (typeof reason === "string") return new Error(reason);
            return new Error("context canceled");
          }
          return null;
        },
      };
    }
  }
  throw new Error(`TALA ${location} requires a context`);
}

export const CanonicalContext = canonicalContext;
