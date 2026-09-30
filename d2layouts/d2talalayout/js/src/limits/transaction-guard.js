/**
 * Shared transaction WorkGuard context helpers — Slice 15.
 *
 * Pinned Go reference:
 *   internal/layoutgraph/transaction.go
 *   internal/layoutgraph/hierarchy_access.go
 */

import { MAX_TRANSACTION_WORK_UNITS } from "./constants.js";
import { WorkContext } from "./work-context.js";
import { WorkGuard } from "./work-guard.js";

export class TransactionWorkContext extends WorkContext {
  /**
   * @param {Object} parentContext
   * @param {WorkGuard} guard
   */
  constructor(parentContext, guard) {
    super({
      isCancelled: () => {
        if (typeof parentContext?.isCancelled === "function") {
          return parentContext.isCancelled();
        }
        if (typeof parentContext?.aborted === "boolean") {
          return parentContext.aborted;
        }
        return false;
      },
      doneAvailable: Boolean(
        parentContext?.doneAvailable ?? (typeof parentContext?.aborted === "boolean")
      ),
    });
    this._parent = parentContext;
    this._transactionWorkGuard = guard;
  }
}

/**
 * Associates a WorkGuard with context as a transaction work guard.
 *
 * @param {Object} context
 * @param {WorkGuard} guard
 * @returns {Object}
 */
export function contextWithTransactionWorkGuard(context, guard) {
  if (context === null || context === undefined || guard === null || guard === undefined) {
    return context;
  }
  return new TransactionWorkContext(context, guard);
}

export const ContextWithTransactionWorkGuard = contextWithTransactionWorkGuard;

/**
 * Checks and returns the request's aggregate transaction guard without
 * allocating a derived context or standalone budget.
 *
 * @param {Object} context
 * @param {string} location
 * @returns {[WorkGuard | null, boolean]}
 */
export function existingTransactionWorkGuard(context, location) {
  if (context === null || context === undefined) {
    throw new Error(`TALA ${location} requires a context`);
  }
  const guard = context._transactionWorkGuard;
  if (guard != null) {
    guard.finish();
    const result = [guard, true];
    result.guard = guard;
    result.exists = true;
    return result;
  }
  const result = [null, false];
  result.guard = null;
  result.exists = false;
  return result;
}

export const ExistingTransactionWorkGuard = existingTransactionWorkGuard;

/**
 * Ensures a shared transaction WorkGuard is available on context.
 *
 * @param {Object} context
 * @param {string} location
 * @returns {[Object, WorkGuard]}
 */
export function ensureTransactionWorkGuard(context, location) {
  const [existingGuard, exists] = existingTransactionWorkGuard(context, location);
  if (exists) {
    const result = [context, existingGuard];
    result.context = context;
    result.guard = existingGuard;
    return result;
  }
  const guard = new WorkGuard(context, location, MAX_TRANSACTION_WORK_UNITS);
  const derivedContext = contextWithTransactionWorkGuard(context, guard);
  const result = [derivedContext, guard];
  result.context = derivedContext;
  result.guard = guard;
  return result;
}

export const EnsureTransactionWorkGuard = ensureTransactionWorkGuard;
